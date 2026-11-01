import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const gitBinary = '/usr/bin/git';
const lintDisable = ['eslint', 'disable'].join('-');
const tsExpectError = ['@ts', 'expect-error'].join('-');
const tsIgnore = ['@ts', 'ignore'].join('-');
const tsNocheck = ['@ts', 'nocheck'].join('-');
const markers = [lintDisable, tsIgnore, tsExpectError, tsNocheck];

export function findEscapeHatches(path: string, text: string): string[] {
  const pattern = new RegExp(markers.join('|'));
  const violations: string[] = [];
  for (const [index, line] of text.split('\n').entries()) {
    if (!pattern.test(line)) continue;
    violations.push(`${path}:${String(index + 1)}`);
  }
  return violations;
}

function main(): void {
  const violations: string[] = [];
  for (const path of trackedFiles()) {
    const text = textIfDecoded(path);
    if (!text) continue;
    violations.push(...findEscapeHatches(path, text));
  }
  if (violations.length === 0) return;

  console.error('Lint and type suppressions are not allowed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
}

function textIfDecoded(path: string): string | undefined {
  const bytes = readFileSync(path);
  return bytes.includes(0) ? undefined : bytes.toString('utf8');
}

function trackedFiles(): string[] {
  return execFileSync(gitBinary, ['ls-files', '-z'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
