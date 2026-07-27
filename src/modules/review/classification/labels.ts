import {
  attributesForPath,
  type CodeownersRule,
  type DiffSeekAttributes,
  type GitAttributeRule,
} from '@diffseek/repository-metadata';

import type { FileRecord } from '../model/file';

import { generatedLabelSource } from './label-sources/generated';
import { groupLabelSource } from './label-sources/group';
import { languageLabelSource } from './label-sources/language';
import { ownerLabelSource } from './label-sources/owner';
import { statusLabelSource } from './label-sources/status';
import { viewedLabelSource } from './label-sources/viewed';

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
};

export type LabelContext = {
  attributes: GitAttributeRule[];
  codeowners: CodeownersRule[];
};

type ClassifiedFile = {
  file: FileRecord;
  attributes: DiffSeekAttributes;
};

export type LabelSource = {
  prepare: (
    files: readonly ClassifiedFile[],
    context: LabelContext,
  ) => (file: ClassifiedFile) => FileLabel[];
};

const defaultLabelSources: LabelSource[] = [
  viewedLabelSource,
  groupLabelSource,
  ownerLabelSource,
  languageLabelSource,
  generatedLabelSource,
  statusLabelSource,
];

export function labelFiles(
  files: FileRecord[],
  context: LabelContext,
  sources: LabelSource[] = defaultLabelSources,
): void {
  const classified = files.map((file) => ({
    file,
    attributes: attributesForPath(file.path, context.attributes),
  }));
  const labelers = sources.map((source) => source.prepare(classified, context));

  for (const classifiedFile of classified) {
    const { file, attributes } = classifiedFile;
    file.generated = attributes.generated;
    file.labels = uniqueLabels(
      labelers.flatMap((labels) => labels(classifiedFile)),
    );
  }
}

function uniqueLabels(labels: FileLabel[]): FileLabel[] {
  const seen = new Set<string>();
  return labels.filter((label) => {
    const key = `${label.facet}\u0000${label.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
