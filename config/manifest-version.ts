export function manifestVersion(
  packageVersion: string,
  branchCommitCount: number,
): string {
  const [major = '0', minor = '0'] = packageVersion.split('.');
  return `${major}.${minor}.${branchCommitCount}`;
}
