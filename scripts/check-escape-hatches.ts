import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { git } from './git-command.ts';

const coverageIgnore = ['c8', 'ignore'].join(' ');
const eslintDisable = ['eslint', 'disable'].join('-');
const eslintEnable = ['eslint', 'enable'].join('-');
const eslintEnv = ['eslint', 'env'].join('-');
const eslintWord = 'eslint';
const eslintBlockConfig = `/* ${eslintWord} `;
const eslintLineConfig = `// ${eslintWord} `;
const istanbulIgnore = ['istanbul', 'ignore'].join(' ');
const jscpdIgnore = ['jscpd', 'ignore'].join(':');
const stylelintDisable = ['stylelint', 'disable'].join('-');
const tsExpectError = ['@ts', 'expect-error'].join('-');
const tsIgnore = ['@ts', 'ignore'].join('-');
const tsNocheck = ['@ts', 'nocheck'].join('-');
const typeCoverageIgnore = ['type', 'coverage:ignore'].join('-');
const v8Ignore = ['v8', 'ignore'].join(' ');
const markers = [
  coverageIgnore,
  eslintBlockConfig,
  eslintDisable,
  eslintEnable,
  eslintEnv,
  eslintLineConfig,
  istanbulIgnore,
  jscpdIgnore,
  stylelintDisable,
  tsExpectError,
  tsIgnore,
  tsNocheck,
  typeCoverageIgnore,
  v8Ignore,
];

const patternChars = '.*+?^${}()|[]\\';

export function findEscapeHatches(path: string, text: string): string[] {
  const pattern = new RegExp(
    markers.map((marker) => escapeMarker(marker)).join('|'),
    'v',
  );
  const violations: string[] = [];
  for (const [index, line] of text.split('\n').entries()) {
    if (!pattern.test(line)) continue;
    violations.push(`${path}:${String(index + 1)}`);
  }
  return violations;
}

function escapeMarker(value: string): string {
  let escaped = '';
  for (const char of value) {
    escaped += patternChars.includes(char) ? `\\${char}` : char;
  }
  return escaped;
}

function main(): void {
  const violations: string[] = [];
  for (const path of trackedFiles()) {
    const text = textIfDecoded(path);
    if (text === undefined) continue;
    violations.push(...findEscapeHatches(path, text));
  }
  if (violations.length === 0) return;

  console.error('Lint and type suppressions are not allowed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
}

function missingFile(error: unknown): boolean {
  return Error.isError(error) && 'code' in error && error.code === 'ENOENT';
}

function readBytes(path: string): Buffer | undefined {
  try {
    return readFileSync(path);
  } catch (error) {
    if (missingFile(error)) return undefined;
    throw error;
  }
}

function textIfDecoded(path: string): string | undefined {
  const bytes = readBytes(path);
  if (bytes === undefined || bytes.includes(0)) return undefined;
  return bytes.toString('utf8');
}

function trackedFiles(): string[] {
  return git(['ls-files', '-z']).split('\0').filter(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
