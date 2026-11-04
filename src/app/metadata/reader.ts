import {
  readCache,
  readPullCache,
  writePullCache,
} from '@diffseek/browser';
import {
  readRawFile,
  resolvePullHead,
  type PullHeadRequest,
  type RawFileRequest,
  type RawFileResult,
} from '@diffseek/github';
import {
  bundledGitAttributes,
  type RepositoryMetadata,
  type RepositoryRef,
} from '@diffseek/repository-metadata';

const codeownersPaths = [
  '.github/CODEOWNERS',
  'CODEOWNERS',
  'docs/CODEOWNERS',
];
const attributeReadConcurrency = 4;
const metadataReadFailure = 'Repository metadata request failed';

type ReadRawFile = (request: RawFileRequest) => Promise<RawFileResult>;
type ResolvePullHead = (request: PullHeadRequest) => Promise<string>;

export async function readImmediateMetadata(
  repository: RepositoryRef & { pull?: number },
): Promise<RepositoryMetadata> {
  try {
    if (repository.pull != null) {
      const cachedPull = await readPullCache({
        ...repository,
        pull: repository.pull,
      });
      if (cachedPull != null) {
        return {
          codeowners: cachedPull.codeowners,
          attributes: cachedPull.attributes,
          ...(cachedPull.codeownersPath !== undefined
            ? { codeownersPath: cachedPull.codeownersPath }
            : {}),
          ...(cachedPull.nestedAttributes !== undefined
            ? { nestedAttributes: cachedPull.nestedAttributes }
            : {}),
        };
      }
    }
    return (await readCache(repository)) ?? bundledMetadata;
  } catch {
    return bundledMetadata;
  }
}

export async function refreshDefaultMetadata(
  repository: RepositoryRef,
  request: ReadRawFile = readRawFile,
): Promise<{ metadata: RepositoryMetadata; changed: boolean }> {
  const cached = await readCache(repository).catch(() => null);
  if (cached != null) return { metadata: cached, changed: false };
  try {
    return {
      metadata: await readSettled(repository, 'HEAD', bundledMetadata, request),
      changed: true,
    };
  } catch {
    return { metadata: bundledMetadata, changed: false };
  }
}

export async function readPullMetadata(
  review: RepositoryRef & { pull: number; paths?: readonly string[] },
  fallback: RepositoryMetadata,
  request: ReadRawFile = readRawFile,
  resolveHead: ResolvePullHead = resolvePullHead,
): Promise<RepositoryMetadata> {
  const ref = await resolveHead({
    repo: `${review.owner}/${review.repo}`,
    pull: review.pull,
  });
  const cached = await readPullCache(review).catch(() => null);
  if (cached?.sha === ref) {
    const { sha, ...metadata } = cached;
    await readNestedAttributes(review, ref, metadata, request);
    await writePullCache(review, sha, metadata).catch(() => undefined);
    return metadata;
  }
  const metadata = await readSettled(
    review,
    ref,
    fallback,
    request,
    (await readCache(review).catch(() => null))?.codeownersPath,
  );
  await readNestedAttributes(review, ref, metadata, request);
  await writePullCache(review, ref, metadata).catch(() => undefined);
  return metadata;
}

async function readNestedAttributes(
  review: RepositoryRef & { paths?: readonly string[] },
  ref: string,
  metadata: RepositoryMetadata,
  request: ReadRawFile,
): Promise<void> {
  const directories = new Set<string>();
  for (const path of review.paths ?? []) {
    const parts = path.split('/');
    for (let length = 1; length < parts.length; length += 1) {
      directories.add(parts.slice(0, length).join('/'));
    }
  }
  const nested = new Map(Object.entries(metadata.nestedAttributes ?? {}));
  const pending = [...directories].filter((directory) => !nested.has(directory));
  if (pending.length === 0) return;
  // Large PRs share ancestors; probe each once with bounded concurrency.
  const reads = await Promise.allSettled(Array.from({ length: Math.min(attributeReadConcurrency, pending.length) }, async () => {
    for (let directory = pending.shift(); directory !== undefined; directory = pending.shift()) {
      const result = await readText(review, ref, `${directory}/.gitattributes`, request);
      if (result.status === 'failed') throw new Error(metadataReadFailure);
      nested.set(directory, result.status === 'found' ? result.text : '');
    }
  }));
  if (reads.some((result) => result.status === 'rejected')) {
    throw new Error(metadataReadFailure);
  }
  metadata.nestedAttributes = Object.fromEntries(nested);
}

type TextRead =
  | { status: 'found'; text: string }
  | { status: 'missing' }
  | { status: 'failed' };

type CodeownersRead =
  | { status: 'found'; path: string; text: string }
  | { status: 'missing' }
  | { status: 'failed' };

async function readSettled(
  repository: RepositoryRef,
  ref: string,
  fallback: RepositoryMetadata,
  request: ReadRawFile,
  preferredPath?: string,
): Promise<RepositoryMetadata> {
  const read = await readMetadata(
    repository,
    ref,
    fallback,
    request,
    preferredPath,
  );
  if (!read.settled) throw new Error(metadataReadFailure);
  return read.metadata;
}

async function readMetadata(
  repository: RepositoryRef,
  ref: string,
  fallback: RepositoryMetadata,
  request: ReadRawFile,
  preferredPath?: string,
): Promise<{ metadata: RepositoryMetadata; settled: boolean }> {
  const paths =
    preferredPath != null && codeownersPaths.includes(preferredPath)
      ? [
          preferredPath,
          ...codeownersPaths.filter((path) => path !== preferredPath),
        ]
      : codeownersPaths;
  const [codeowners, attributes] = await Promise.all([
    readFirst(repository, ref, paths, request),
    readText(repository, ref, '.gitattributes', request),
  ]);
  const codeownersPath =
    codeowners.status === 'found' ? codeowners.path : fallback.codeownersPath;
  return {
    settled: codeowners.status !== 'failed' && attributes.status !== 'failed',
    metadata: {
      codeowners:
        codeowners.status === 'found' ? codeowners.text : fallback.codeowners,
      attributes:
        attributes.status === 'found' ? attributes.text : fallback.attributes,
      ...(codeownersPath !== undefined ? { codeownersPath } : {}),
    },
  };
}

async function readFirst(
  repository: RepositoryRef,
  ref: string,
  paths: string[],
  request: ReadRawFile,
): Promise<CodeownersRead> {
  for (const path of paths) {
    const value = await readText(repository, ref, path, request);
    if (value.status === 'found') {
      return { status: 'found', path, text: value.text };
    }
    if (value.status === 'failed') return { status: 'failed' };
  }
  return { status: 'missing' };
}

async function readText(
  repository: RepositoryRef,
  ref: string,
  path: string,
  request: ReadRawFile,
): Promise<TextRead> {
  try {
    const result = await request({
      repo: `${repository.owner}/${repository.repo}`,
      ref,
      path,
    });
    return result.status === 'found'
      ? { status: 'found', text: result.text }
      : { status: 'missing' };
  } catch {
    return { status: 'failed' };
  }
}

const bundledMetadata: RepositoryMetadata = {
  codeowners: '',
  attributes: bundledGitAttributes,
};
