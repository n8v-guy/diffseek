import { describe, expect, it } from 'vitest';

import {
  attributesForPath,
  parseGitAttributes,
} from './gitattributes';

describe('.gitattributes', () => {
  it('applies matching assignments independently in source order', () => {
    const rules = parseGitAttributes(`
* group=code linguist-generated=false
docs/** group=docs
*.ts linguist-language=TypeScript
*.tsx linguist-language=TypeScript
vendor/** linguist-generated
vendor/source/** -linguist-generated
`);

    expect(attributesForPath('docs/guide.md', rules)).toEqual({
      group: 'docs',
      language: null,
      generated: false,
    });
    expect(attributesForPath('src/app.ts', rules).language).toBe('TypeScript');
    expect(attributesForPath('vendor/app.js', rules).generated).toBe(true);
    expect(
      attributesForPath('vendor/source/app.js', rules).generated,
    ).toBe(false);
  });

  it('supports root, basename, globstar, and single-character patterns', () => {
    const rules = parseGitAttributes(`
/README.?d group=root
*.md group=markdown
docs/**/generated/*.md linguist-generated
`);

    expect(attributesForPath('README.md', rules).group).toBe('markdown');
    expect(attributesForPath('nested/README.md', rules).group).toBe('markdown');
    expect(
      attributesForPath('docs/api/generated/index.md', rules).generated,
    ).toBe(true);
    expect(
      attributesForPath('docs/generated/index.md', rules).generated,
    ).toBe(true);
  });

  it('clears values with unset and unspecified assignments', () => {
    const rules = parseGitAttributes(`
*.ts group=code linguist-language=TypeScript linguist-generated
vendor/** -group !linguist-language linguist-generated=false
`);

    expect(attributesForPath('vendor/app.ts', rules)).toEqual({
      group: null,
      language: null,
      generated: false,
    });
  });

  it('reads quoted and escaped values and ignores unsupported lines', () => {
    const rules = parseGitAttributes(`
# comment
*.fs linguist-language="F Sharp" group=typed\\ files
!secret/** group=secret
[attr]macro group=macro
`);

    expect(attributesForPath('src/app.fs', rules)).toEqual({
      group: 'typed files',
      language: 'F Sharp',
      generated: false,
    });
    expect(attributesForPath('secret/key.fs', rules).group).toBe(
      'typed files',
    );
  });

  it('matches paths case-sensitively', () => {
    const rules = parseGitAttributes('docs/** group=docs');

    expect(attributesForPath('docs/readme.md', rules).group).toBe('docs');
    expect(attributesForPath('Docs/readme.md', rules).group).toBeNull();
  });

  it('scopes basename patterns to the attributes directory and descendants', () => {
    const rules = parseGitAttributes(
      '*.json linguist-generated=true',
      'apps/contributor/openapi',
    );

    for (const path of ['metadata.json', 'auth/api.json']) {
      expect(
        attributesForPath(`apps/contributor/openapi/${path}`, rules).generated,
      ).toBe(true);
    }
    for (const path of [
      'metadata.json',
      'apps/contributor/metadata.json',
      'apps/organisation/openapi/metadata.json',
      'apps/contributor/openapi-other/metadata.json',
    ]) {
      expect(attributesForPath(path, rules).generated).toBe(false);
    }
  });

  it.each(['', 'apps/contributor'])(
    'anchors a leading slash in attributes directory "%s"',
    (directory) => {
      const rules = parseGitAttributes(
        '/metadata.json linguist-generated', directory,
      );
      const prefix = directory ? `${directory}/` : '';

      expect(
        attributesForPath(`${prefix}metadata.json`, rules).generated,
      ).toBe(true);
      expect(
        attributesForPath(`${prefix}nested/metadata.json`, rules).generated,
      ).toBe(false);
    },
  );

  it('resolves slash-containing and quoted patterns relative to their directory', () => {
    const rules = parseGitAttributes(`
generated/** linguist-generated
"api docs/**/*.json" linguist-generated
`, 'web-apps/portal');

    for (const path of [
      'generated/models/client.ts',
      'api docs/schema.json',
      'api docs/auth/schema.json',
    ]) {
      expect(
        attributesForPath(`web-apps/portal/${path}`, rules).generated,
      ).toBe(true);
      expect(
        attributesForPath(`web-apps/portal/nested/${path}`, rules).generated,
      ).toBe(false);
      expect(
        attributesForPath(`web-apps/other/${path}`, rules).generated,
      ).toBe(false);
    }
  });

  it('treats metacharacters in the attributes directory as literal path text', () => {
    const directory = 'apps/[client]+(v1.0)$^*?{schema}|';
    const rules = parseGitAttributes('*.json linguist-generated', directory);

    expect(attributesForPath(`${directory}/api.json`, rules).generated).toBe(true);
    expect(attributesForPath('apps/client/api.json', rules).generated).toBe(false);
  });

  it('lets deeper attributes override and reset individual inherited values', () => {
    const rules = [
      ...parseGitAttributes('*.json linguist-generated group=API'),
      ...parseGitAttributes('*.json -linguist-generated', 'apps/manual'),
      ...parseGitAttributes(
        '*.json linguist-generated !group', 'apps/manual/generated',
      ),
      ...parseGitAttributes(
        '*.json !linguist-generated', 'apps/manual/generated/review',
      ),
    ];

    expect(attributesForPath('apps/manual/schema.json', rules)).toEqual({
      generated: false, group: 'API', language: null,
    });
    expect(attributesForPath('apps/manual/generated/schema.json', rules)).toEqual({
      generated: true, group: null, language: null,
    });
    expect(attributesForPath(
      'apps/manual/generated/review/schema.json', rules,
    )).toEqual({
      generated: false, group: null, language: null,
    });
    expect(attributesForPath('apps/other/schema.json', rules)).toEqual({
      generated: true, group: 'API', language: null,
    });
  });
});
