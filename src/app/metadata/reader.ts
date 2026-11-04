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
    cached != null && !refreshDue(cached, review.pull, timestamp) ? cached : null;
  const index =
    current?.files ?? (await discover(review, cached?.files ?? {}, request, search));
  const files = await readInto(
    index,
    unloadedMetadataPaths(index, review.paths),
    defaultBranch,
    review,
    request,
  );
  const pulls = current?.pulls ?? [];
  const cache = {
    files,
    refreshedAt: current?.refreshedAt ?? timestamp,
    pulls: pulls.includes(review.pull) ? pulls : [...pulls, review.pull],
  };
  return {
    metadata: metadataFromFiles(files),
    cache,
    changed: JSON.stringify(cache) !== JSON.stringify(cached),
  };
}

/** The pull request's own version of metadata files that the diff touches. */
export async function readPullMetadata(
  review: Review,
  base: DefaultMetadata,
  dependencies: Partial<Dependencies> = {},
): Promise<RepositoryMetadata> {
  const { request = readRawFile, resolveHead = resolvePullHead } = dependencies;
  const paths = pullMetadataPaths(review.paths);
  if (paths.length === 0) return base.metadata;
  const ref = await resolveHead({
    repo: `${review.owner}/${review.repo}`,
    pull: review.pull,
  });
  return metadataFromFiles(
    await readInto(base.cache.files, paths, ref, review, request),
  );
}

function refreshDue(cache: RepositoryCache, pull: number, now: number): boolean {
  return (
    now - cache.refreshedAt >= refreshIntervalMs ||
    (!cache.pulls.includes(pull) && cache.pulls.length >= pullsPerRefresh)
  );
}

async function discover(
  review: Review,
  cached: MetadataFiles,
  request: Dependencies['request'],
  search: Dependencies['search'],
): Promise<MetadataFiles> {
  try {
    const found = await search({ repo: `${review.owner}/${review.repo}` });
    const index: MetadataFiles = {};
    for (const { path, blob } of found) {
      const known = cached[path];
      if (isMetadataPath(path)) {
        index[path] = known?.blob === blob ? known : { blob };
      }
    }
    return index;
  } catch {
    return probe(review, request);
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
