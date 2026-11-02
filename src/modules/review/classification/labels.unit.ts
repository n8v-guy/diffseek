import {
  parseCodeowners,
  parseGitAttributes,
} from '@diffseek/repository-metadata';
import { describe, expect, it } from 'vitest';

import type { FileRecord } from '../model/file';
import type { FileLabel } from './label';

import { labelFiles, type LabelSource } from './labels';

const typeScriptLanguage: FileLabel = {
  facet: 'languages',
  fromLinguistLanguage: true,
  value: 'TypeScript',
};

const customGroupSource: LabelSource = {
  prepare: () => customGroupLabels,
};

describe('file labels', () => {
  it('labels every independent facet from repository metadata', () => {
    const files = [
      file('src/app.test.ts', '.ts'),
      file('src/view.tsx', '.tsx'),
    ];

    labelFiles(files, {
      attributes: parseGitAttributes(`
src/** group=code linguist-language=TypeScript
src/app.test.ts linguist-generated
`),
      codeowners: parseCodeowners('src/** @team'),
    });

    const generated = fileAt(files, 0);
    const extension = fileAt(files, 1);
    expect(generated.labels).toStrictEqual(
      expect.arrayContaining([
        { facet: 'groups', value: 'code' },
        { facet: 'owners', value: '@team' },
        typeScriptLanguage,
        { facet: 'statuses', value: 'added' },
        { facet: 'generated', value: 'true' },
      ]),
    );
    expect(languageLabels(generated)).toStrictEqual([typeScriptLanguage]);
    expect(languageLabels(extension)).toStrictEqual([typeScriptLanguage]);
  });

  it('falls back to the file extension or No extension', () => {
    const files = [
      file('src/app.ts', '.ts'),
      file('scripts/build.MJS', '.MJS'),
      file('LICENSE', null),
    ];

    labelFiles(files, {
      attributes: parseGitAttributes(
        '*.ts linguist-language=TypeScript',
      ),
      codeowners: [],
    });

    expect(languageLabels(fileAt(files, 0))).toStrictEqual([typeScriptLanguage]);
    expect(languageLabels(fileAt(files, 1))).toStrictEqual([
      { facet: 'languages', value: 'MJS' },
    ]);
    expect(languageLabels(fileAt(files, 2))).toStrictEqual([
      { facet: 'languages', value: 'No extension' },
    ]);
  });

  it('labels only viewed files with the viewed facet', () => {
    const viewed = file('src/viewed.ts', '.ts');
    const pending = file('src/pending.ts', '.ts');
    viewed.viewed = true;

    labelFiles([viewed, pending], { attributes: [], codeowners: [] });

    expect(viewed.labels).toContainEqual({ facet: 'viewed', value: 'true' });
    expect(pending.labels).not.toContainEqual({
      facet: 'viewed',
      value: 'true',
    });
  });

  it('labels files without a resolved owner as Unmapped', () => {
    const readme = file('docs/readme.md', '.md');
    readme.owners = [];

    labelFiles([readme], {
      attributes: [],
      codeowners: parseCodeowners('src/** @team'),
    });

    expect(readme.labels).toContainEqual({
      facet: 'owners',
      value: 'Unmapped',
    });
  });

  it('labels files without a repository group as No groups', () => {
    const notes = file('misc/notes.txt', '.txt');

    labelFiles([notes], { attributes: [], codeowners: [] });

    expect(notes.labels).toContainEqual({
      facet: 'groups',
      value: 'No groups',
    });
  });
});

describe('replaceable label sources', () => {
  it('composes independently replaceable label sources', () => {
    const files = [file('src/app.ts', '.ts')];

    labelFiles(
      files,
      { attributes: [], codeowners: [] },
      [customGroupSource],
    );

    expect(fileAt(files, 0).labels).toStrictEqual([
      { facet: 'groups', value: 'custom' },
    ]);
  });
});

function customGroupLabels(): FileLabel[] {
  return [{ facet: 'groups', value: 'custom' }];
}

function file(path: string, extension: null | string): FileRecord {
  return {
    anchor: `diff-${path}`,
    capabilities: { collapse: true, viewed: true },
    extension,
    generated: false,
    labels: [],
    owners: ['@native'],
    path,
    status: 'added',
    viewed: false,
  };
}

function fileAt(files: readonly FileRecord[], index: number): FileRecord {
  const record = files[index];
  if (record === undefined) throw new Error(`Missing fixture file ${index}`);
  return record;
}

function languageLabels(record: FileRecord): FileLabel[] {
  return record.labels.filter((label) => label.facet === 'languages');
}
