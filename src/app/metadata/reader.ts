import { readCache } from '@diffseek/browser/cache';
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
  repository: RepositoryRef,
): Promise<RepositoryMetadata> {
  try {
    return (await readCache(repository)) ?? bundledMetadata;
  } catch {
    return bundledMetadata;
  }
}

export async function refreshDefaultMetadata(
  repository: RepositoryRef,
  request: ReadRawFile = readRawFile,
): Promise<{ metadata: RepositoryMetadata; changed: boolean }> {
  const fallback = await readImmediateMetadata(repository);
  const metadata = await readMetadata(repository, 'HEAD', fallback, request);
  const changed = JSON.stringify(fallback) !== JSON.stringify(metadata);
  return { metadata, changed };
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
  return readMetadata(review, ref, fallback, request);
}

async function readMetadata(
  repository: RepositoryRef,
  ref: string,
  fallback: RepositoryMetadata,
  request: ReadRawFile,
): Promise<RepositoryMetadata> {
  const [codeowners, attributes] = await Promise.allSettled([
    readFirst(repository, ref, codeownersPaths, request),
    readText(repository, ref, '.gitattributes', request),
  ]);
  return {
    codeowners:
      codeowners.status === 'fulfilled' && codeowners.value != null
        ? codeowners.value
        : fallback.codeowners,
    attributes:
      attributes.status === 'fulfilled' && attributes.value != null
        ? attributes.value
        : fallback.attributes,
  };
}

async function readFirst(
  repository: RepositoryRef,
  ref: string,
  paths: string[],
  request: ReadRawFile,
): Promise<string | null> {
  for (const path of paths) {
    const value = await readText(repository, ref, path, request);
    if (value != null) return value;
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
