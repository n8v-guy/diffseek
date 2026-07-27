#!/usr/bin/env -S node --experimental-strip-types

import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  TEST_SUFFIXES,
  TYPESCRIPT_SOURCE_ROOTS,
} from '../config/project.config.ts';

const testLikePattern =
  /\.(?:tests?|specs?|unit|e2e(?:\.playwright)?)\.tsx?$/;
const sourceLayers = new Set(['adapters', 'app', 'modules']);

export function findStructureViolations(paths: string[]): string[] {
  const violations: string[] = [];
  const knownPaths = new Set(paths);

  for (const filePath of paths) {
    if (filePath.startsWith('docs/superpowers/')) {
      violations.push(
        `${filePath}: generated planning artifact is tracked`,
      );
      continue;
    }
    if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) continue;

    if (
      filePath.startsWith('src/') &&
      !sourceLayers.has(filePath.split('/')[1] ?? '')
    ) {
      violations.push(
        `${filePath}: source is outside an architectural layer`,
      );
      continue;
    }

    const [root] = filePath.split('/');
    if (
      !TYPESCRIPT_SOURCE_ROOTS.includes(
        root as (typeof TYPESCRIPT_SOURCE_ROOTS)[number],
      )
    ) {
      violations.push(`${filePath}: TypeScript is outside configured roots`);
      continue;
    }

    if (
      testLikePattern.test(filePath) &&
      !TEST_SUFFIXES.some((suffix) => filePath.endsWith(suffix))
    ) {
      violations.push(`${filePath}: unsupported test suffix`);
    }

    const namesakeViolation = findNamesakeViolation(filePath, knownPaths);
    if (namesakeViolation) violations.push(namesakeViolation);
  }

  return violations.sort();
}

function findNamesakeViolation(
  filePath: string,
  knownPaths: Set<string>,
): string | null {
  if (
    !filePath.startsWith('src/') &&
    !filePath.startsWith('scripts/')
  ) {
    return null;
  }
  const suffix = TEST_SUFFIXES.find((candidate) =>
    filePath.endsWith(candidate),
  );
  if (!suffix) return null;
  const source = `${filePath.slice(0, -suffix.length)}.ts`;
  return knownPaths.has(source)
    ? null
    : `${filePath}: missing namesake module ${source}`;
}

function main(): void {
  const files = execFileSync('git', ['ls-files'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
  const violations = findStructureViolations(files);
  if (violations.length === 0) return;

  console.error('Repository structure violations:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
