const packageVersionSegments = 2;

export function manifestVersion(
  packageVersion: string,
  branchCommitCount: number,
): string {
  const [major = '0', minor = '0'] = packageVersion.split(
    '.',
    packageVersionSegments,
  );
  return `${major}.${minor}.${branchCommitCount}`;
}
