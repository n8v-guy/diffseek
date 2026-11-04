import type { RepositoryMetadata } from './metadata';

/** A default-branch metadata file; `text` is absent until it is read. */
type MetadataFile = { blob: string; text?: string };
export type MetadataFiles = Record<string, MetadataFile>;

/** In GitHub's order of precedence. */
export const codeownersLocations = [
  '.github/CODEOWNERS',
  'CODEOWNERS',
  'docs/CODEOWNERS',
];

const attributesName = '.gitattributes';

export function isMetadataPath(path: string): boolean {
  return isAttributesPath(path) || codeownersLocations.includes(path);
}

export function chooseCodeowners(paths: readonly string[]): string | undefined {
  return codeownersLocations.find((location) => paths.includes(location));
}

/** Files to read for a diff: the chosen CODEOWNERS and the ancestor attributes. */
export function unloadedMetadataPaths(
  files: MetadataFiles,
  diffPaths: readonly string[],
): string[] {
  const known = Object.keys(files);
  const directories = new Set<string>(diffPaths.length > 0 ? [''] : []);
  for (const path of diffPaths) {
    const parts = path.split('/');
    for (let length = 1; length < parts.length; length += 1) {
      directories.add(parts.slice(0, length).join('/'));
    }
  }
  const codeowners = chooseCodeowners(known);
  return known.filter(
    (path) =>
      files[path]?.text === undefined &&
      (path === codeowners ||
        (isAttributesPath(path) && directories.has(directoryOf(path)))),
  );
}

/** Diff paths whose own version on the pull request replaces the default. */
export function pullMetadataPaths(diffPaths: readonly string[]): string[] {
  return diffPaths.filter(isMetadataPath);
}

export function metadataFromFiles(files: MetadataFiles): RepositoryMetadata {
  const codeowners = chooseCodeowners(Object.keys(files));
  const nestedAttributes: Record<string, string> = {};
  for (const [path, { text }] of Object.entries(files)) {
    if (text !== undefined && path !== attributesName && isAttributesPath(path)) {
      nestedAttributes[directoryOf(path)] = text;
    }
  }
  return {
    codeowners: (codeowners && files[codeowners]?.text) || '',
    attributes: files[attributesName]?.text ?? '',
    nestedAttributes,
  };
}

function isAttributesPath(path: string): boolean {
  return path === attributesName || path.endsWith(`/${attributesName}`);
}

function directoryOf(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf('/')));
}
