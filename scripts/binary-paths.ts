/**
 * Paths git itself treats as binary, read from `git diff --numstat -z`
 * output. Detection is by content (git prints `-` for both counts), not by
 * file extension.
 */
export function findBinaryPaths(numstat: string): string[] {
  const paths: string[] = [];
  for (const record of numstat.split('\0')) {
    const path = binaryPath(record);
    if (path !== undefined) paths.push(path);
  }
  return paths;
}

function binaryPath(record: string): string | undefined {
  if (record === '') return undefined;
  const [added, deleted, ...rest] = record.split('\t');
  const path = rest.join('\t');
  if (added === '-' && deleted === '-' && path !== '') return path;
  return undefined;
}
