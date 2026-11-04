import { describe, expect, it } from 'vitest';

import {
  chooseCodeowners,
  isMetadataPath,
  metadataFromFiles,
  pullMetadataPaths,
  unloadedMetadataPaths,
  type MetadataFiles,
} from './metadata-files';

const known = (...paths: string[]): MetadataFiles =>
  Object.fromEntries(paths.map((path) => [path, { blob: path }]));

describe('metadata files', () => {
  it('chooses one CODEOWNERS by GitHub precedence', () => {
    expect(chooseCodeowners(['docs/CODEOWNERS', 'CODEOWNERS', '.github/CODEOWNERS']))
      .toBe('.github/CODEOWNERS');
    expect(chooseCodeowners(['docs/CODEOWNERS', 'CODEOWNERS'])).toBe('CODEOWNERS');
    expect(chooseCodeowners(['docs/CODEOWNERS'])).toBe('docs/CODEOWNERS');
    expect(chooseCodeowners(['src/CODEOWNERS', '.gitattributes'])).toBeUndefined();
  });

  it('selects the chosen CODEOWNERS and only ancestor-or-same attribute files', () => {
    const files = known(
      '.github/CODEOWNERS',
      'docs/CODEOWNERS',
      '.gitattributes',
      'apps/.gitattributes',
      'apps/web/.gitattributes',
      'apps/web/ui/.gitattributes',
      'apps/api/.gitattributes',
      'tools/.gitattributes',
    );

    expect(unloadedMetadataPaths(files, ['apps/web/main.ts', 'apps/web/ui/a/b.ts'])).toEqual([
      '.github/CODEOWNERS',
      '.gitattributes',
      'apps/.gitattributes',
      'apps/web/.gitattributes',
      'apps/web/ui/.gitattributes',
    ]);
    expect(unloadedMetadataPaths(files, ['apps/web/ui/.gitattributes'])).toContain(
      'apps/web/ui/.gitattributes',
    );
  });

  it('never selects a directory that is not above a diff path', () => {
    const files = known('apps/web/.gitattributes', 'apps/webby/.gitattributes');
    expect(unloadedMetadataPaths(files, ['apps/webby/x.ts'])).toEqual([
      'apps/webby/.gitattributes',
    ]);
  });

  it('selects nothing for a diff with no paths except CODEOWNERS and skips loaded files', () => {
    const files: MetadataFiles = {
      ...known('CODEOWNERS', 'apps/.gitattributes'),
      '.gitattributes': { blob: 'r', text: '*.ts group=Code' },
    };
    expect(unloadedMetadataPaths(files, [])).toEqual(['CODEOWNERS']);
    expect(unloadedMetadataPaths(files, ['apps/a.ts'])).toEqual([
      'CODEOWNERS',
      'apps/.gitattributes',
    ]);
  });

  it('recognises metadata paths in the diff but not look-alikes', () => {
    expect(
      pullMetadataPaths([
        'src/a.ts',
        '.gitattributes',
        'apps/.gitattributes',
        'docs/CODEOWNERS',
        'src/CODEOWNERS',
        'apps/.gitattributes.bak',
      ]),
    ).toEqual(['.gitattributes', 'apps/.gitattributes', 'docs/CODEOWNERS']);
    expect(isMetadataPath('.github/CODEOWNERS')).toBe(true);
    expect(isMetadataPath('src/CODEOWNERS')).toBe(false);
  });

  it('builds metadata with per-directory scoping and empty attributes when the repository has none', () => {
    expect(metadataFromFiles({})).toEqual({
      codeowners: '',
      attributes: '',
      nestedAttributes: {},
    });
    expect(
      metadataFromFiles({
        'docs/CODEOWNERS': { blob: 'a', text: '* @docs' },
        CODEOWNERS: { blob: 'b', text: '* @root' },
        '.gitattributes': { blob: 'c', text: '*.ts group=Code' },
        'apps/.gitattributes': { blob: 'd', text: '*.json linguist-generated' },
        'apps/web/.gitattributes': { blob: 'e' },
      }),
    ).toEqual({
      codeowners: '* @root',
      attributes: '*.ts group=Code',
      nestedAttributes: { apps: '*.json linguist-generated' },
    });
  });
});
