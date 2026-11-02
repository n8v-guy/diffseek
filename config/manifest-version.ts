export function manifestVersion(
  packageVersion: string,
  branchCommitCount: number,
): string {
  const [major = '0', minor = '0'] = packageVersion.split('.', 2);
  return [major, minor, branchCommitCount].join('.');
}
