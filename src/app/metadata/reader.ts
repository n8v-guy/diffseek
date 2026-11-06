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

/** Default-branch listing lifetime: 7 days. */
export const defaultMetadataTtlMs = 604_800_000;
/** Pull-request metadata file lifetime: 2 days. */
export const pullMetadataTtlMs = 172_800_000;

const defaultBranch = 'HEAD';
const attributesPath = '.gitattributes';

type Review = RepositoryRef & { pull: number; paths: readonly string[] };
type Dependencies = {
  request: (request: RawFileRequest) => Promise<RawFileResult>;
  search: (request: { repo: string }) => Promise<MetadataSearchResult>;
  resolveHead: (request: PullHeadRequest) => Promise<string>;
  now: () => number;
  /** Reread entries past their TTL. Otherwise a due entry is served from the cache. */
  revalidate: boolean;
};

type PullOverlay = RepositoryCache['overlays'][string];

export type DefaultMetadata = {
  metadata: RepositoryMetadata;
  cache: RepositoryCache;
  changed: boolean;
  /**
   * Head lookup started beside a default-branch search for this read only.
   * It is not stored.
   */
  pendingHead?: Promise<string>;
  /** A cached entry is past its TTL and this read left it unchanged. */
  due?: boolean;
  /** A body or listing read failed. Not stored. Tried once more, then left until quiet. */
  failed?: boolean;
};

export async function readImmediateMetadata(
  repository: RepositoryRef & { pull?: number },
): Promise<RepositoryMetadata> {
  try {
    const cache = await readCache(repository);
    return displayed(cache?.files ?? {}, overlayFiles(cache, repository.pull));
  } catch {
    return metadataFromFiles({});
  }
}

/**
 * A fresh listing comes from the cache. A missing listing is searched now.
 * A due listing is served as cached unless this read is the quiet reread.
 * Either way, only relevant files that are not loaded yet are read.
 */
export async function refreshDefaultMetadata(
  review: Review,
  dependencies: Partial<Dependencies> = {},
): Promise<DefaultMetadata> {
  const {
    request = readRawFile,
    search = searchMetadataFiles,
    now = Date.now,
    revalidate = false,
  } = dependencies;
  const cached = await readCache(review).catch(() => null);
  const timestamp = now();
  const pendingHead = dependencies.resolveHead
    ? primeHead(review, cached, timestamp, revalidate, dependencies.resolveHead)
    : undefined;
  // Listing bodies stay on the default branch. A failure here must not block
  // the pull request's own files, and must not be stored as a fresh listing.
  try {
    const current =
      cached != null && !(listingDue(cached, timestamp) && revalidate)
        ? cached
        : await refreshListing(review, cached, timestamp, request, search);
    try {
      const files = await readInto(
        current.files,
        unloadedMetadataPaths(current.files, review.paths),
        defaultBranch,
        review,
        request,
      );
      const cache = withPull(current, files, review.pull);
      return {
        metadata: displayed(files, overlayFiles(cache, review.pull)),
        cache,
        changed: JSON.stringify(cache) !== JSON.stringify(cached),
        ...(pendingHead ? { pendingHead } : {}),
        due: listingDue(cache, timestamp),
      };
    } catch {
      // The bodies did not load. Keep the previous listing and its time.
      return failedDefault(cached, pendingHead, review.pull);
    }
  } catch {
    return failedDefault(cached, pendingHead, review.pull);
  }
}

/** A failed read is not a fresh listing. The pull can still use the head. */
function failedDefault(
  cached: RepositoryCache | null,
  pendingHead: Promise<string> | undefined,
  pull: number,
): DefaultMetadata {
  return {
    metadata: displayed(cached?.files ?? {}, overlayFiles(cached, pull)),
    cache: cached ?? { files: {}, refreshedAt: 0, pulls: [], overlays: {} },
    changed: false,
    ...(pendingHead ? { pendingHead } : {}),
    due: true,
    failed: true,
  };
}

/** Diff metadata paths only. A stored file, including a deletion, is reused until that copy is reread. */
export async function readPullMetadata(
  review: Review,
  base: DefaultMetadata,
  dependencies: Partial<Dependencies> = {},
): Promise<DefaultMetadata> {
  const {
    request = readRawFile,
    resolveHead = resolvePullHead,
    now = Date.now,
    revalidate = false,
  } = dependencies;
  const paths = pullMetadataPaths(review.paths);
  const key = String(review.pull);
  const saved = base.cache.overlays[key];
  const timestamp = now();
  if (paths.length === 0) return unchanged(base);
  if (
    saved &&
    overlayDue(saved, timestamp) &&
    !revalidate &&
    paths.every((path) => saved.files[path] !== undefined)
  ) {
    return servePull(base, saved, paths);
  }
  return loadPull({
    review,
    base,
    paths,
    saved,
    key,
    timestamp,
    revalidate,
    request,
    resolveHead,
  });
}

function unchanged(base: DefaultMetadata): DefaultMetadata {
  return { metadata: base.metadata, cache: base.cache, changed: false, due: false };
}

function servePull(
  base: DefaultMetadata,
  saved: PullOverlay,
  paths: string[],
): DefaultMetadata {
  return {
    metadata: metadataFromFiles(
      overlaid(base.cache.files, applicable(saved.files, paths)),
    ),
    cache: base.cache,
    changed: false,
    due: true,
  };
}

type PullLoad = {
  review: Review;
  base: DefaultMetadata;
  paths: string[];
  saved: PullOverlay | undefined;
  key: string;
  timestamp: number;
  revalidate: boolean;
  request: Dependencies['request'];
  resolveHead: Dependencies['resolveHead'];
};

async function loadPull(load: PullLoad): Promise<DefaultMetadata> {
  const { review, base, paths, saved, key, timestamp, revalidate, request } = load;
  const replacing = revalidate && saved != null && overlayDue(saved, timestamp);
  const covered =
    saved != null && paths.every((path) => saved.files[path] !== undefined);
  const oid = await pullOid(load, covered, replacing);
  const previous = saved != null && saved.oid === oid ? saved.files : undefined;
  const missing = previous
    ? paths.filter((path) => previous[path] === undefined)
    : paths;
  const read = await readInto({}, missing, oid, review, request);
  const overlay = {
    oid,
    refreshedAt:
      saved != null && saved.oid === oid && !replacing ? saved.refreshedAt : timestamp,
    files: {
      ...previous,
      ...Object.fromEntries(
        missing.map((path) => [path, read[path]?.text ?? null]),
      ),
    },
  };
  const { files, merged } = await withFallback(
    base.cache.files,
    overlay.files,
    paths,
    review,
    request,
  );
  const cache = {
    ...base.cache,
    files,
    overlays: { ...base.cache.overlays, [key]: overlay },
  };
  return {
    metadata: metadataFromFiles(merged),
    cache,
    changed: JSON.stringify(cache) !== JSON.stringify(base.cache),
    due: overlayDue(overlay, timestamp),
  };
}

async function withFallback(
  files: MetadataFiles,
  overlay: Record<string, string | null>,
  paths: string[],
  review: Review,
  request: Dependencies['request'],
): Promise<{ files: MetadataFiles; merged: MetadataFiles }> {
  let next = files;
  let merged = overlaid(next, applicable(overlay, paths));
  const codeowners = chooseCodeowners(Object.keys(merged));
  if (codeowners !== undefined && merged[codeowners]?.text === undefined) {
    try {
      next = await readInto(next, [codeowners], defaultBranch, review, request);
      merged = overlaid(next, applicable(overlay, paths));
    } catch {
      // The pull texts already read stay usable when the default read fails.
    }
  }
  return { files: next, merged };
}

/** One retry when the lookup started beside the listing has already failed. */
async function pullOid(
  load: PullLoad,
  covered: boolean,
  replacing: boolean,
): Promise<string> {
  const { review, base, saved, resolveHead } = load;
  if (covered && !replacing && saved) return saved.oid;
  const request = (): Promise<string> =>
    resolveHead({ repo: `${review.owner}/${review.repo}`, pull: review.pull });
  try {
    return await (base.pendingHead ?? request());
  } catch {
    return request();
  }
}

function primeHead(
  review: Review,
  cached: RepositoryCache | null,
  now: number,
  revalidate: boolean,
  resolveHead: Dependencies['resolveHead'],
): Promise<string> | undefined {
  if (!overlayNeedsHead(review, cached, now, revalidate)) return undefined;
  const pending = resolveHead({
    repo: `${review.owner}/${review.repo}`,
    pull: review.pull,
  });
  void pending.catch(() => undefined);
  return pending;
}

/** A stored head is reused until a diff path is missing or the due copy is reread. */
function overlayNeedsHead(
  review: Review,
  cached: RepositoryCache | null,
  now: number,
  revalidate: boolean,
): boolean {
  const paths = pullMetadataPaths(review.paths);
  if (paths.length === 0) return false;
  const saved = cached?.overlays[String(review.pull)];
  if (!saved) return true;
  if (paths.some((path) => saved.files[path] === undefined)) return true;
  return revalidate && overlayDue(saved, now);
}

function withPull(
  current: RepositoryCache,
  files: MetadataFiles,
  pull: number,
): RepositoryCache {
  return {
    ...current,
    files,
    pulls: current.pulls.includes(pull) ? current.pulls : [...current.pulls, pull],
  };
}

function listingDue(cache: RepositoryCache, now: number): boolean {
  return now - cache.refreshedAt >= defaultMetadataTtlMs;
}

function overlayDue(overlay: PullOverlay, now: number): boolean {
  return now - overlay.refreshedAt >= pullMetadataTtlMs;
}

function applicable(
  files: Record<string, string | null>,
  paths: readonly string[],
): Record<string, string | null> {
  const allowed = new Set(paths);
  return Object.fromEntries(
    Object.entries(files).filter(([path]) => allowed.has(path)),
  );
}

function overlayFiles(
  cache: RepositoryCache | null,
  pull: number | undefined,
): Record<string, string | null> | undefined {
  if (pull === undefined) return undefined;
  return cache?.overlays[String(pull)]?.files;
}

/** Listing files with this pull's stored copy applied. A null entry stays deleted. */
function displayed(
  files: MetadataFiles,
  overlay: Record<string, string | null> | undefined,
): RepositoryMetadata {
  return metadataFromFiles(overlay === undefined ? files : overlaid(files, overlay));
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
    pulls: cached?.pulls ?? [],
    overlays: cached?.overlays ?? {},
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
    // A cached listing stays as it is. The caller marks that read failed.
    if (cached) throw new Error('Metadata search is unavailable');
    return listed(await probe(review, request));
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
