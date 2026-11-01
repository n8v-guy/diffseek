import { execFileSync, spawnSync } from 'node:child_process';
import process from 'node:process';

export function runCommand(
  command: string,
  args: string[],
  input?: string,
): string {
  return execFileSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    input,
  });
}

export function runCommandInherit(command: string, args: string[]): number {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    stdio: 'inherit',
  });
  return result.status ?? 1;
}
