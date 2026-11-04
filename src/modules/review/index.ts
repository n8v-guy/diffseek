export { extensionOf } from './classification/groups';
export { labelFiles, type LabelFacet } from './classification/labels';
export { projectFacet } from './filtering/facet-projection';
export {
  emptyFacetExclusions,
  excludedFacetCount,
  facetChoices,
  facetDefinitions,
  isFallbackFacetValue,
  matchesFacets,
} from './filtering/facets';
export {
  bucketActionPaths,
  fileViewedLabel,
  includeCountedFiles,
  scopeAriaPressed,
  scopeViewedLabel,
  viewedMark,
  type CountBucket,
} from './filtering/viewed-scope';
export type { ChangeStatus, FileRecord, FilterState } from './model/file';
export { ReviewIndex } from './model/review-index';
export { FileCatalog } from './session/file-catalog';
export {
  changedSurfaces,
  planView,
  type ViewPlan,
} from './session/view-plan';
