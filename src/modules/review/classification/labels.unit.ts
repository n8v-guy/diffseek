import { describe, expect, it } from 'vitest';

import {
  parseCodeowners,
  parseGitAttributes,
} from '@diffseek/repository-metadata';

import type { FileRecord } from '../model/file';

import { labelFiles, type LabelSource } from './labels';

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

    expect(files[0]?.labels).toEqual(
      expect.arrayContaining([
        { facet: 'groups', value: 'code' },
        { facet: 'owners', value: '@team' },
        { facet: 'languages', value: 'TypeScript', mapped: true },
        { facet: 'statuses', value: 'added' },
        { facet: 'generated', value: 'true' },
      ]),
    );
    expect(languageLabels(files[0]!)).toEqual([
      { facet: 'languages', value: 'TypeScript', mapped: true },
    ]);
    expect(languageLabels(files[1]!)).toEqual([
      { facet: 'languages', value: 'TypeScript', mapped: true },
    ]);
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

    expect(languageLabels(files[0]!)).toEqual([
      { facet: 'languages', value: 'TypeScript', mapped: true },
    ]);
    expect(languageLabels(files[1]!)).toEqual([
      { facet: 'languages', value: 'MJS' },
    ]);
    expect(languageLabels(files[2]!)).toEqual([
      { facet: 'languages', value: 'No extension' },
    ]);
  });

  it('labels only viewed files with the viewed facet', () => {
    const files = [
      file('src/viewed.ts', '.ts'),
      file('src/pending.ts', '.ts'),
    ];
    files[0]!.viewed = true;

    labelFiles(files, { attributes: [], codeowners: [] });

    expect(files[0]?.labels).toContainEqual({
      facet: 'viewed',
      value: 'true',
    });
    expect(files[1]?.labels).not.toContainEqual({
      facet: 'viewed',
      value: 'true',
    });
  });

  it('labels files without a resolved owner as Unmapped', () => {
    const files = [file('docs/readme.md', '.md')];
    files[0]!.owners = [];

    labelFiles(files, {
      attributes: [],
      codeowners: parseCodeowners('src/** @team'),
    });

    expect(files[0]?.labels).toContainEqual({
      facet: 'owners',
      value: 'Unmapped',
    });
  });

  it('labels files without a repository group as No type', () => {
    const files = [file('misc/notes.txt', '.txt')];

    labelFiles(files, { attributes: [], codeowners: [] });

    expect(files[0]?.labels).toContainEqual({
      facet: 'groups',
      value: 'No type',
    });
  });

  it('composes independently replaceable label sources', () => {
    const files = [file('src/app.ts', '.ts')];
    const source: LabelSource = {
      prepare: () => () => [{ facet: 'groups', value: 'custom' }],
    };

    labelFiles(
      files,
      { attributes: [], codeowners: [] },
      [source],
    );

    expect(files[0]?.labels).toEqual([
      { facet: 'groups', value: 'custom' },
    ]);
  });
});

function file(path: string, extension: string | null): FileRecord {
  return {
    path,
    anchor: `diff-${path}`,
    extension,
    owners: ['@native'],
    generated: false,
    status: 'added',
    viewed: false,
    capabilities: { collapse: true, viewed: true },
    labels: [],
  };
}

function languageLabels(file: FileRecord) {
  return file.labels.filter((label) => label.facet === 'languages');
}
