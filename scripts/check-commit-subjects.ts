import { readFileSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { git } from './git-command.ts';

const messageFileFlag = '--message-file';
const shortHashLength = 12;

export function findSubjectViolation(message: string): string | undefined {
  const lines = stripCommitComments(message).replaceAll('\r\n', '\n').split('\n');
  while (lines.at(-1) === '') lines.pop();
  if (lines.length === 0 || lines[0]?.trim() === '') return 'empty subject';
  if (lines.length > 1) return 'subject must be a single line';
  return undefined;
}

export function stripCommitComments(message: string): string {
  return git(['stripspace', '--strip-comments'], message);
}

function branchName(): string {
  const fromCi = process.env.GITHUB_REF_NAME;
  if (fromCi !== undefined) return fromCi;
  return git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
}

function commitsSinceMain(): string[] {
  git(['rev-parse', '--verify', 'origin/main']);
  return git(['rev-list', '--no-merges', 'origin/main..HEAD'])
    .split('\n')
    .filter(Boolean);
}

function historyViolations(): string[] {
  if (branchName().startsWith('dependabot/')) return [];
  const violations: string[] = [];
  for (const hash of commitsSinceMain()) {
    const violation = findSubjectViolation(git(['log', '-1', '--format=%B', hash]));
    if (violation === undefined) continue;
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
  if (violation === undefined) return [];
  return [violation];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
