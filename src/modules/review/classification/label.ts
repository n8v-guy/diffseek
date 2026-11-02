export const labelFacets = [
  'viewed',
  'groups',
  'owners',
  'languages',
  'generated',
  'statuses',
] as const;

export interface FileLabel {
  facet: LabelFacet;
  fromLinguistLanguage?: boolean;
  value: string;
}

export type LabelFacet = (typeof labelFacets)[number];
