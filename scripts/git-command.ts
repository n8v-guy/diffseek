import { runCommand } from './run-command.ts';

export function git(args: string[], input?: string): string {
  return runCommand('git', args, input);
}
