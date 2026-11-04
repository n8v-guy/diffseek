export { bundledGitAttributes } from './bundled-gitattributes';
export {
  ownersForPathOrNull,
  parseCodeowners,
  type CodeownersRule,
} from './codeowners';
export { MetadataCommitGuard } from './commit-guard';
export {
  attributesForPath,
  parseGitAttributes,
  type DiffSeekAttributes,
  type GitAttributeRule,
} from './gitattributes';
export {
  codeownersLocations,
  isMetadataPath,
  metadataFromFiles,
  pullMetadataPaths,
  unloadedMetadataPaths,
  type MetadataFiles,
} from './metadata-files';
export type { RepositoryMetadata, RepositoryRef } from './metadata';
