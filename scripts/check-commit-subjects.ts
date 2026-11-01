import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const gitBinary = '/usr/bin/git';
const messageFileFlag = '--message-file';
const shortHashLength = 12;

export function findSubjectViolation(message: string): string | undefined {
  const lines = message.replaceAll('\r\n', '\n').split('\n');
  while (lines.at(-1) === '') lines.pop();
  if (lines.length === 0 || lines[0]?.trim() === '') return 'empty subject';
  if (lines.length > 1) return 'subject must be a single line';
  return undefined;
}

function git(gitArguments: string[]): string {
  return execFileSync(gitBinary, gitArguments, {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

function historyViolations(): string[] {
  const hashes = git(['rev-list', 'HEAD']).split('\n').filter(Boolean);
  const violations: string[] = [];
  for (const hash of hashes) {
    const violation = findSubjectViolation(
      git(['log', '-1', '--format=%B', hash]),
    );
    if (!violation) continue;
    violations.push(`${hash.slice(0, shortHashLength)} ${violation}`);
  }
  return violations;
}

function main(): void {
  const fileFlag = process.argv.indexOf(messageFileFlag);
  const violations =
    fileFlag === -1
      ? historyViolations()
      : messageFileViolations(process.argv[fileFlag + 1] ?? '');
  if (violations.length === 0) return;

  console.error('Commit subjects must be one non-empty line:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
}

function messageFileViolations(path: string): string[] {
  const violation = findSubjectViolation(readFileSync(path, 'utf8'));
  return violation ? [violation] : [];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
