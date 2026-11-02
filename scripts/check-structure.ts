import { execFileSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  TEST_SUFFIXES,
  TYPESCRIPT_SOURCE_ROOTS,
} from '../config/project.config.ts';

const testLikePattern =
  /\.(?:tests?|specs?|unit|e2e(?:\.playwright)?)\.tsx?$/v;
const sourceLayers = new Set(['adapters', 'app', 'modules']);

export function findStructureViolations(paths: string[]): string[] {
  const violations: string[] = [];
  const knownPaths = new Set(paths);
  for (const filePath of paths) {
    const violation = findViolation(filePath, knownPaths);
    if (violation !== null) violations.push(violation);
  }
  return violations.toSorted((left, right) => left.localeCompare(right));
}

function findNamesakeViolation(
  filePath: string,
  knownPaths: Set<string>,
): null | string {
  if (
    !filePath.startsWith('src/') &&
    !filePath.startsWith('scripts/')
  ) {
    return null;
  }
  const suffix = TEST_SUFFIXES.find((candidate) =>
    filePath.endsWith(candidate),
  );
  // Playwright e2e may be orchestration-only without a product namesake.
  if (!suffix || suffix === '.e2e.playwright.ts') return null;
  const source = `${filePath.slice(0, -suffix.length)}.ts`;
  return knownPaths.has(source)
    ? null
    : `${filePath}: missing namesake module ${source}`;
}

function findViolation(
  filePath: string,
  knownPaths: Set<string>,
): null | string {
  if (filePath.startsWith('docs/superpowers/')) {
    return `${filePath}: generated planning artifact is tracked`;
  }
  if (!filePath.endsWith('.ts') && !filePath.endsWith('.tsx')) return null;
  if (
    filePath.startsWith('src/') &&
    !sourceLayers.has(filePath.split('/', 2)[1] ?? '')
  ) {
    return `${filePath}: source is outside an architectural layer`;
  }
  const [root] = filePath.split('/', 1);
  if (TYPESCRIPT_SOURCE_ROOTS.every((sourceRoot) => sourceRoot !== root)) {
    return `${filePath}: TypeScript is outside configured roots`;
  }
  if (
    testLikePattern.test(filePath) &&
    TEST_SUFFIXES.every((suffix) => !filePath.endsWith(suffix))
  ) {
    return `${filePath}: unsupported test suffix`;
  }
  return findNamesakeViolation(filePath, knownPaths);
}

function main(): void {
  const files = execFileSync('git', ['ls-files'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
    .split('\n')
    .filter((file) => file !== '');
  const violations = findStructureViolations(files);
  if (violations.length === 0) return;

  console.error('Repository structure violations:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
