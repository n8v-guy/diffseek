import {
  readCache,
  readPullCache,
  writePullCache,
} from '@diffseek/browser/cache';
import type { PullHeadRequest } from '@diffseek/github/repository-content/pull-head';
import { resolvePullHead } from '@diffseek/github/repository-content/pull-head-client';
import type { RawFileRequest, RawFileResult } from '@diffseek/github/repository-content/raw-file';
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
        const { sha: _sha, ...metadata } = cachedPull;
        return metadata;
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
  const metadata = await readMetadata(
    repository,
    'HEAD',
    bundledMetadata,
    request,
  );
  return { metadata, changed: true };
}

export async function readPullMetadata(
  review: RepositoryRef & { pull: number },
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
    await writePullCache(review, sha, metadata).catch(() => undefined);
    return metadata;
  }
  const metadata = await readMetadata(
    review,
    ref,
    fallback,
    request,
    (await readCache(review).catch(() => null))?.codeownersPath,
  );
  await writePullCache(review, ref, metadata).catch(() => undefined);
  return metadata;
}

async function readMetadata(
  repository: RepositoryRef,
  ref: string,
  fallback: RepositoryMetadata,
  request: ReadRawFile,
  preferredPath?: string,
): Promise<RepositoryMetadata> {
  const paths =
    preferredPath != null && codeownersPaths.includes(preferredPath)
      ? [
          preferredPath,
          ...codeownersPaths.filter((path) => path !== preferredPath),
        ]
      : codeownersPaths;
  const [codeowners, attributes] = await Promise.allSettled([
    readFirst(repository, ref, paths, request),
    readText(repository, ref, '.gitattributes', request),
  ]);
  return {
    codeowners:
      codeowners.status === 'fulfilled' && codeowners.value != null
        ? codeowners.value.text
        : fallback.codeowners,
    attributes:
      attributes.status === 'fulfilled' && attributes.value != null
        ? attributes.value
        : fallback.attributes,
    codeownersPath:
      codeowners.status === 'fulfilled' && codeowners.value != null
        ? codeowners.value.path
        : fallback.codeownersPath,
  };
}

async function readFirst(
  repository: RepositoryRef,
  ref: string,
  paths: string[],
  request: ReadRawFile,
): Promise<{ path: string; text: string } | null> {
  for (const path of paths) {
    const value = await readText(repository, ref, path, request);
    if (value != null) return { path, text: value };
  }
  return null;
}

async function readText(
  repository: RepositoryRef,
  ref: string,
  path: string,
  request: ReadRawFile,
): Promise<string | null> {
  const result = await request({
    repo: `${repository.owner}/${repository.repo}`,
    ref,
    path,
  });
  return result.status === 'found' ? result.text : null;
}

const bundledMetadata: RepositoryMetadata = {
  codeowners: '',
  attributes: bundledGitAttributes,
};
