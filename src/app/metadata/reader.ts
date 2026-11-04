import { readCache, type RepositoryCache } from '@diffseek/browser';
import {
  readRawFile,
  resolvePullHead,
  searchMetadataFiles,
  type MetadataSearchResult,
  type PullHeadRequest,
  type RawFileRequest,
  type RawFileResult,
} from '@diffseek/github';
import {
  chooseCodeowners,
  codeownersLocations,
  isMetadataPath,
  metadataFromFiles,
  pullMetadataPaths,
  unloadedMetadataPaths,
  type MetadataFiles,
  type RepositoryMetadata,
  type RepositoryRef,
} from '@diffseek/repository-metadata';

const refreshIntervalMs = 86_400_000;
const pullsPerRefresh = 3;
const defaultBranch = 'HEAD';
const attributesPath = '.gitattributes';

type Review = RepositoryRef & { pull: number; paths: readonly string[] };
type Dependencies = {
  request: (request: RawFileRequest) => Promise<RawFileResult>;
  search: (request: { repo: string }) => Promise<MetadataSearchResult>;
  resolveHead: (request: PullHeadRequest) => Promise<string>;
  now: () => number;
};

export type DefaultMetadata = {
  metadata: RepositoryMetadata;
  cache: RepositoryCache;
  changed: boolean;
};

export async function readImmediateMetadata(
  repository: RepositoryRef,
): Promise<RepositoryMetadata> {
  try {
    return metadataFromFiles((await readCache(repository))?.files ?? {});
  } catch {
    return metadataFromFiles({});
  }
}

/**
 * Warm reads come from the cache alone. A cold or due cache costs one search
 * and reads only the relevant files; a warm one reads only newly relevant ones.
 */
export async function refreshDefaultMetadata(
  review: Review,
  dependencies: Partial<Dependencies> = {},
): Promise<DefaultMetadata> {
  const { request = readRawFile, search = searchMetadataFiles, now = Date.now } =
    dependencies;
  const cached = await readCache(review).catch(() => null);
  const timestamp = now();
  const current =
    cached != null && !refreshDue(cached, review.pull, timestamp)
      ? cached
      : await refreshListing(review, cached, timestamp, request, search);
  const files = await readInto(
    current.files,
    unloadedMetadataPaths(current.files, review.paths),
    defaultBranch,
    review,
    request,
  );
  const cache = {
    ...current,
    files,
    pulls: current.pulls.includes(review.pull)
      ? current.pulls
      : [...current.pulls, review.pull],
  };
  return {
    metadata: metadataFromFiles(files),
    cache,
    changed: JSON.stringify(cache) !== JSON.stringify(cached),
  };
}

/**
 * The pull request's own version of the metadata files its diff touches. It is
 * resolved once per pull and kept until the default branch refreshes.
 */
export async function readPullMetadata(
  review: Review,
  base: DefaultMetadata,
  dependencies: Partial<Dependencies> = {},
): Promise<DefaultMetadata> {
  const { request = readRawFile, resolveHead = resolvePullHead } = dependencies;
  const paths = pullMetadataPaths(review.paths);
  if (paths.length === 0) return { ...base, changed: false };
  const key = String(review.pull);
  const saved = base.cache.overlays[key];
  const missing = paths.filter((path) => saved?.files[path] === undefined);
  const oid =
    saved?.oid ??
    (await resolveHead({ repo: `${review.owner}/${review.repo}`, pull: review.pull }));
  const read = await readInto({}, missing, oid, review, request);
  const overlay = {
    oid,
    files: {
      ...saved?.files,
      ...Object.fromEntries(missing.map((path) => [path, read[path]?.text ?? null])),
    },
  };
  let files = base.cache.files;
  let merged = overlaid(files, overlay.files);
  const codeowners = chooseCodeowners(Object.keys(merged));
  if (codeowners !== undefined && merged[codeowners]?.text === undefined) {
    files = await readInto(files, [codeowners], defaultBranch, review, request);
    merged = overlaid(files, overlay.files);
  }
  const cache = { ...base.cache, files, overlays: { ...base.cache.overlays, [key]: overlay } };
  return {
    metadata: metadataFromFiles(merged),
    cache,
    changed: JSON.stringify(cache) !== JSON.stringify(base.cache),
  };
}

function overlaid(
  files: MetadataFiles,
  overlay: Record<string, string | null>,
): MetadataFiles {
  const kept = Object.entries(files).filter(([path]) => overlay[path] === undefined);
  const replaced = Object.entries(overlay).flatMap(([path, text]) =>
    text === null ? [] : [[path, { blob: files[path]?.blob ?? '', text }] as const],
  );
  return Object.fromEntries([...kept, ...replaced]);
}

function refreshDue(cache: RepositoryCache, pull: number, now: number): boolean {
  return (
    now - cache.refreshedAt >= refreshIntervalMs ||
    (!cache.pulls.includes(pull) && cache.pulls.length >= pullsPerRefresh)
  );
}

/** A failed search keeps any cached listing, even an empty one; only no cache probes. */
async function refreshListing(
  review: Review,
  cached: RepositoryCache | null,
  timestamp: number,
  request: Dependencies['request'],
  search: Dependencies['search'],
): Promise<RepositoryCache> {
  const listed = (files: MetadataFiles): RepositoryCache => ({
    files,
    refreshedAt: timestamp,
    pulls: [],
    overlays: {},
  });
  try {
    const found = await search({ repo: `${review.owner}/${review.repo}` });
    const index: MetadataFiles = {};
    for (const { path, blob } of found) {
      const known = cached?.files[path];
      if (isMetadataPath(path)) {
        index[path] = known?.blob === blob ? known : { blob };
      }
    }
    return listed(index);
  } catch {
    return cached ?? listed(await probe(review, request));
  }
}

/** Without search: the root attributes and at most three CODEOWNERS spots. */
async function probe(
  review: Review,
  request: Dependencies['request'],
): Promise<MetadataFiles> {
  let files = await readInto({}, [attributesPath], defaultBranch, review, request);
  for (const location of codeownersLocations) {
    files = await readInto(files, [location], defaultBranch, review, request);
    if (files[location]) break;
  }
  return files;
}

/** Reads each path at `ref`; a missing file is dropped, a failed read throws. */
async function readInto(
  files: MetadataFiles,
  paths: string[],
  ref: string,
  review: Review,
  request: Dependencies['request'],
): Promise<MetadataFiles> {
  const next = { ...files };
  const missing = new Set<string>();
  await Promise.all(
    paths.map(async (path) => {
      const result = await request({
        repo: `${review.owner}/${review.repo}`,
        ref,
        path,
      });
      if (result.status === 'found') {
        next[path] = { blob: files[path]?.blob ?? '', text: result.text };
      } else {
        missing.add(path);
      }
    }),
  );
  return Object.fromEntries(
    Object.entries(next).filter(([path]) => !missing.has(path)),
  );
}
