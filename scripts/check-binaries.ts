#!/usr/bin/env -S node --experimental-strip-types

import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * Paths git itself treats as binary, read from `git diff --numstat -z`
 * output. Detection is by content (git prints `-` for both counts), not by
 * file extension.
 */
export function findBinaryPaths(numstat: string): string[] {
  return numstat
    .split('\0')
    .filter(Boolean)
    .flatMap((record) => {
      const [added, deleted, ...rest] = record.split('\t');
      const path = rest.join('\t');
      return added === '-' && deleted === '-' && path ? [path] : [];
    });
}

function git(args: string[], input?: string): string {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    input,
  });
}

function main(): void {
  const staged = process.argv.includes('--staged');
  // Diffing against git's empty tree lists every file in HEAD.
  const emptyTree = staged
    ? ''
    : git(['hash-object', '-t', 'tree', '--stdin'], '').trim();
  // Staged: what this commit adds or changes (removing a binary is fine).
  // Otherwise: every file in the HEAD tree, which CI cannot skip.
  const args = staged
    ? ['diff', '--cached', '--numstat', '-z', '--no-renames', '--diff-filter=d']
    : ['diff', '--numstat', '-z', '--no-renames', emptyTree, 'HEAD'];
  const binaries = findBinaryPaths(git(args));
  if (binaries.length === 0) return;

  console.error(
    staged
      ? 'Binary files are not allowed in commits. Unstage:'
      : 'Binary files are not allowed in the repository:',
  );
  for (const path of binaries) console.error(`- ${path}`);
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
