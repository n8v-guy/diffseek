import type { PullHeadRequest } from '@diffseek/github/repository-content/pull-head';
import type { RawFileRequest, RawFileResult } from '@diffseek/github/repository-content/raw-file';

import {
  readCache,
  readPullCache,
  writePullCache,
} from '@diffseek/browser/cache';
import { resolvePullHead } from '@diffseek/github/repository-content/pull-head-client';
import { readRawFile } from '@diffseek/github/repository-content/raw-file-client';
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

type CodeownersRead =
  | { path: string; status: 'found'; text: string }
  | { status: 'failed' }
  | { status: 'missing' };
interface MetadataRead {
  fallback: RepositoryMetadata;
  preferredPath?: string;
  ref: string;
  repository: RepositoryRef;
  request: ReadRawFile;
}

type ReadRawFile = (request: RawFileRequest) => Promise<RawFileResult>;

type ResolvePullHead = (request: PullHeadRequest) => Promise<string>;

type TextRead =
  | { status: 'failed' }
  | { status: 'found'; text: string }
  | { status: 'missing' };

const bundledMetadata: RepositoryMetadata = {
  attributes: bundledGitAttributes,
  codeowners: '',
};

export async function readImmediateMetadata(
  repository: RepositoryRef & { pull?: number },
): Promise<RepositoryMetadata> {
  try {
    return await immediateOrBundled(repository);
  } catch {
    return bundledMetadata;
  }
}

export async function readPullMetadata(
  review: RepositoryRef & { pull: number },
  fallback: RepositoryMetadata,
  request: ReadRawFile = readRawFile,
  resolveHead: ResolvePullHead = resolvePullHead,
): Promise<RepositoryMetadata> {
  const ref = await resolveHead({
    pull: review.pull,
    repo: `${review.owner}/${review.repo}`,
  });
  const cached = await settledOrNull(readPullCache(review));
  if (cached?.sha === ref) {
    const metadata = withoutSha(cached);
    await settledOrUndefined(writePullCache(review, cached.sha, metadata));
    return metadata;
  }
  const preferredPath = (await settledOrNull(readCache(review)))?.codeownersPath;
  const metadata = await readSettled({
    fallback,
    ref,
    repository: review,
    request,
    ...(preferredPath !== undefined && { preferredPath }),
  });
  await settledOrUndefined(writePullCache(review, ref, metadata));
  return metadata;
}

export async function refreshDefaultMetadata(
  repository: RepositoryRef,
  request: ReadRawFile = readRawFile,
): Promise<{ changed: boolean; metadata: RepositoryMetadata; }> {
  const cached = await settledOrNull(readCache(repository));
  if (cached !== null) return { changed: false, metadata: cached };
  try {
    return {
      changed: true,
      metadata: await readSettled({
        fallback: bundledMetadata,
        ref: 'HEAD',
        repository,
        request,
      }),
    };
  } catch {
    return { changed: false, metadata: bundledMetadata };
  }
}

async function immediateOrBundled(
  repository: RepositoryRef & { pull?: number },
): Promise<RepositoryMetadata> {
  if (repository.pull !== undefined) {
    const cachedPull = await readPullCache({
      ...repository,
      pull: repository.pull,
    });
    if (cachedPull !== null) return withoutSha(cachedPull);
  }
  return (await readCache(repository)) ?? bundledMetadata;
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
      return { path, status: 'found', text: value.text };
    }
    if (value.status === 'failed') return { status: 'failed' };
  }
  return { status: 'missing' };
}

async function readMetadata(
  read: MetadataRead,
): Promise<{ metadata: RepositoryMetadata; settled: boolean }> {
  const preferred = read.preferredPath;
  const paths =
    preferred !== undefined && codeownersPaths.includes(preferred)
      ? [preferred, ...codeownersPaths.filter((path) => path !== preferred)]
      : codeownersPaths;
  const [codeowners, attributes] = await Promise.all([
    readFirst(read.repository, read.ref, paths, read.request),
    readText(read.repository, read.ref, '.gitattributes', read.request),
  ]);
  const codeownersPath =
    codeowners.status === 'found' ? codeowners.path : read.fallback.codeownersPath;
  return {
    metadata: {
      attributes:
        attributes.status === 'found' ? attributes.text : read.fallback.attributes,
      codeowners:
        codeowners.status === 'found' ? codeowners.text : read.fallback.codeowners,
      ...(codeownersPath !== undefined && { codeownersPath }),
    },
    settled: codeowners.status !== 'failed' && attributes.status !== 'failed',
  };
}

async function readSettled(read: MetadataRead): Promise<RepositoryMetadata> {
  const loaded = await readMetadata(read);
  if (!loaded.settled) throw new Error('Repository metadata request failed');
  return loaded.metadata;
}

async function readText(
  repository: RepositoryRef,
  ref: string,
  path: string,
  request: ReadRawFile,
): Promise<TextRead> {
  try {
    return textRead(await request({
      path,
      ref,
      repo: `${repository.owner}/${repository.repo}`,
    }));
  } catch {
    return { status: 'failed' };
  }
}

async function settledOrNull<T>(work: Promise<T>): Promise<null | T> {
  try {
    return await work;
  } catch {
    return null;
  }
}

async function settledOrUndefined(work: Promise<void>): Promise<void> {
  try {
    await work;
  } catch {
    // A cache write failure leaves the fetched metadata usable.
  }
}

function textRead(result: RawFileResult): TextRead {
  return result.status === 'found'
    ? { status: 'found', text: result.text }
    : { status: 'missing' };
}

function withoutSha(
  cached: RepositoryMetadata & { sha: string },
): RepositoryMetadata {
  const metadata: RepositoryMetadata = {
    attributes: cached.attributes,
    codeowners: cached.codeowners,
  };
  if (cached.codeownersPath !== undefined) {
    metadata.codeownersPath = cached.codeownersPath;
  }
  return metadata;
}
