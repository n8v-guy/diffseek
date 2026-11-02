#!/usr/bin/env -S node --experimental-strip-types

import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { findBinaryPaths } from './binary-paths.ts';
import { git } from './git-command.ts';

const noRenamesFlag = '--no-renames';
const numstatFlag = '--numstat';

function main(): void {
  const staged = process.argv.includes('--staged');
  // Diffing against git's empty tree lists every file in HEAD.
  const emptyTree = staged
    ? ''
    : git(['hash-object', '-t', 'tree', '--stdin'], '').trim();
  // Staged: what this commit adds or changes (removing a binary is fine).
  // Otherwise: every file in the HEAD tree, which CI cannot skip.
  const args = staged
    ? ['diff', '--cached', numstatFlag, '-z', noRenamesFlag, '--diff-filter=d']
    : ['diff', numstatFlag, '-z', noRenamesFlag, emptyTree, 'HEAD'];
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
