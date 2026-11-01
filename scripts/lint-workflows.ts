import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runCommand, runCommandInherit } from './run-command.ts';

const actionlintVersion = '1.7.12';
const cacheDirectory = path.join(process.cwd(), '.cache', 'workflow-linters');
const executableMode = 0o755;
const zizmorVersion = '1.31.1';

function archiveName(tool: 'actionlint' | 'zizmor'): string {
  const arch = linuxArch(tool);
  if (tool === 'actionlint') {
    return `actionlint_${actionlintVersion}_linux_${arch}.tar.gz`;
  }
  return `zizmor-${arch}-unknown-linux-gnu.tar.gz`;
}

function archiveUrl(tool: 'actionlint' | 'zizmor'): string {
  const name = archiveName(tool);
  if (tool === 'actionlint') {
    return `https://github.com/rhysd/actionlint/releases/download/v${actionlintVersion}/${name}`;
  }
  return `https://github.com/zizmorcore/zizmor/releases/download/v${zizmorVersion}/${name}`;
}

function ensureBinary(tool: 'actionlint' | 'zizmor'): string {
  const binary = path.join(cacheDirectory, tool);
  if (existsSync(binary)) return binary;
  mkdirSync(cacheDirectory, { recursive: true });
  const archive = path.join(tmpdir(), archiveName(tool));
  runCommand('curl', ['-fsSL', archiveUrl(tool), '-o', archive]);
  runCommand('tar', ['-xzf', archive, '-C', cacheDirectory, tool]);
  chmodSync(binary, executableMode);
  return binary;
}

function linuxArch(tool: 'actionlint' | 'zizmor'): string {
  if (process.arch === 'arm64') {
    return tool === 'actionlint' ? 'arm64' : 'aarch64';
  }
  return tool === 'actionlint' ? 'amd64' : 'x86_64';
}

function main(): void {
  const actionlint = runCommandInherit(ensureBinary('actionlint'), []);
  const zizmor = runCommandInherit(ensureBinary('zizmor'), ['.github/workflows']);
  if (actionlint !== 0 || zizmor !== 0) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
