#!/usr/bin/env -S node --experimental-strip-types

import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { git } from './git-command.ts';
import { findStructureViolations } from './structure-violations.ts';

function main(): void {
  const files = git(['ls-files'])
    .split('\n')
    .filter((file) => file !== '');
  const violations = findStructureViolations(files);
  if (violations.length === 0) return;

  console.error('Repository structure violations:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
