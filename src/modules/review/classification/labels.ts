import {
  attributesForPath,
  type CodeownersRule,
  type DiffSeekAttributes,
  type GitAttributeRule,
  ownersForPathOrNull,
} from '@diffseek/repository-metadata';

import type { FileRecord } from '../model/file';
import type { FileLabel } from './label';

export { type FileLabel, type LabelFacet } from './label';

export interface LabelContext {
  attributes: GitAttributeRule[];
  codeowners: CodeownersRule[];
}

export interface LabelSource {
  prepare: (
    files: readonly ClassifiedFile[],
    context: LabelContext,
  ) => (file: ClassifiedFile) => FileLabel[];
}

interface ClassifiedFile {
  attributes: DiffSeekAttributes;
  file: FileRecord;
}

function generatedLabels({ attributes }: ClassifiedFile): FileLabel[] {
  return [{ facet: 'generated', value: String(attributes.generated) }];
}

function groupLabels({ attributes }: ClassifiedFile): FileLabel[] {
  return [{ facet: 'groups', value: attributes.group ?? 'No groups' }];
}

function languageLabel({ attributes, file }: ClassifiedFile): FileLabel {
  const language = attributes.language;
  if (language !== null && language.length > 0) {
    return {
      facet: 'languages',
      fromLinguistLanguage: true,
      value: language,
    };
  }
  return {
    facet: 'languages',
    value: file.extension?.slice(1) ?? 'No extension',
  };
}

function languageLabels(classified: ClassifiedFile): FileLabel[] {
  return [languageLabel(classified)];
}

function statusLabels({ file }: ClassifiedFile): FileLabel[] {
  return [{ facet: 'statuses', value: file.status }];
}

function viewedLabels({ file }: ClassifiedFile): FileLabel[] {
  return file.viewed ? [{ facet: 'viewed', value: 'true' }] : [];
}

const viewedLabelSource: LabelSource = {
  prepare: () => viewedLabels,
};

const groupLabelSource: LabelSource = {
  prepare: () => groupLabels,
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
  prepare: () => languageLabels,
};

const generatedLabelSource: LabelSource = {
  prepare: () => generatedLabels,
};

const statusLabelSource: LabelSource = {
  prepare: () => statusLabels,
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
    attributes: attributesForPath(file.path, context.attributes),
    file,
  }));
  const labelers = sources.map((source) => source.prepare(classified, context));

  for (const classifiedFile of classified) {
    const { attributes, file } = classifiedFile;
    file.generated = attributes.generated;
    file.labels = uniqueLabels(
      labelers.flatMap((labels) => labels(classifiedFile)),
    );
  }
}

function uniqueLabels(labels: FileLabel[]): FileLabel[] {
  const seen = new Set<string>();
  return labels.filter((label) => {
    const key = `${label.facet}\0${label.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
