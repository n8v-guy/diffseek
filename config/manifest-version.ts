import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

export const buildNumberEnv = 'DIFFSEEK_BUILD_NUMBER';
export const buildNumberFile = 'build-number';

export function manifestVersion(
  packageVersion: string,
  branchCommitCount: number,
): string {
  const [major = '0', minor = '0'] = packageVersion.split('.');
  return `${major}.${minor}.${branchCommitCount}`;
}

/** First non-empty source wins. Callers choose env, file, and git order. */
export function buildNumber(sources: Array<string | undefined>): number {
  const raw = sources.find((value) => value?.trim());
  if (raw == null || !/^\d+$/.test(raw.trim())) {
    throw new Error('Build number must be a non-negative integer');
  }
  return Number(raw.trim());
}

export function readBuildNumberFile(): string | undefined {
  return existsSync(buildNumberFile)
    ? readFileSync(buildNumberFile, 'utf8')
    : undefined;
}

export function gitHeadCount(): string | undefined {
  try {
    return execFileSync('git', ['rev-list', '--count', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return undefined;
  }
}
