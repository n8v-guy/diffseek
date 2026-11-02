import {
  attributesForPath,
  type CodeownersRule,
  type DiffSeekAttributes,
  type GitAttributeRule,
  ownersForPathOrNull,
} from '@diffseek/repository-metadata';

import type { FileRecord } from '../model/file';

import { labelFacets, type FileLabel, type LabelFacet } from './label';

export { labelFacets, type FileLabel, type LabelFacet };

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

const viewedLabelSource: LabelSource = {
  prepare: () => ({ file }) =>
    file.viewed ? [{ facet: 'viewed', value: 'true' }] : [],
};

const groupLabelSource: LabelSource = {
  prepare: () => ({ attributes }) => [
    { facet: 'groups', value: attributes.group ?? 'No groups' },
  ],
};

const ownerLabelSource: LabelSource = {
  prepare: (_files, context) => ({ file }) => {
    const owners =
      ownersForPathOrNull(file.path, context.codeowners) ?? file.owners;
    return (owners.length > 0 ? owners : ['Unmapped']).map((value) => ({
      facet: 'owners',
      value,
    }));
  },
};

const languageLabelSource: LabelSource = {
  prepare: () => ({ file, attributes }) => [
    attributes.language
      ? {
          facet: 'languages',
          value: attributes.language,
          fromLinguistLanguage: true,
        }
      : {
          facet: 'languages',
          value: file.extension?.slice(1) ?? 'No extension',
        },
  ],
};

const generatedLabelSource: LabelSource = {
  prepare: () => ({ attributes }) => [
    { facet: 'generated', value: String(attributes.generated) },
  ],
};

const statusLabelSource: LabelSource = {
  prepare: () => ({ file }) => [{ facet: 'statuses', value: file.status }],
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
