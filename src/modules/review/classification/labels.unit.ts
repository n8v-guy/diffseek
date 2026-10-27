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
        { facet: 'languages', value: 'TypeScript' },
        { facet: 'statuses', value: 'added' },
        { facet: 'generated', value: 'true' },
      ]),
    );
    expect(languageValues(files[0]!)).toEqual(['TypeScript']);
    expect(languageValues(files[1]!)).toEqual(['TypeScript']);
  });

  it('falls back to lowercase extensions and No extension', () => {
    const files = [
      file('src/app.ts', '.ts'),
      file('scripts/build.MJS', '.MJS'),
      file('config/App.YAML', '.YAML'),
      file('config/other.yaml', '.yaml'),
      file('LICENSE', null),
    ];

    labelFiles(files, {
      attributes: parseGitAttributes(
        '*.ts linguist-language=TypeScript',
      ),
      codeowners: [],
    });

    expect(languageValues(files[0]!)).toEqual(['TypeScript']);
    expect(languageValues(files[1]!)).toEqual(['mjs']);
    expect(languageValues(files[2]!)).toEqual(['yaml']);
    expect(languageValues(files[3]!)).toEqual(['yaml']);
    expect(languageValues(files[4]!)).toEqual(['No extension']);
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

function languageValues(file: FileRecord): string[] {
  return file.labels
    .filter((label) => label.facet === 'languages')
    .map((label) => label.value);
}
