export const labelFacets = [
  'viewed',
  'groups',
  'owners',
  'languages',
  'generated',
  'statuses',
] as const;

export type LabelFacet = (typeof labelFacets)[number];

export type FileLabel = {
  facet: LabelFacet;
  value: string;
  fromLinguistLanguage?: boolean;
};
