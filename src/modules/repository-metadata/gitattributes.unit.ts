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

    expect(attributesForPath('docs/guide.md', rules)).toStrictEqual({
      generated: false,
      group: 'docs',
      language: null,
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

    expect(attributesForPath('vendor/app.ts', rules)).toStrictEqual({
      generated: false,
      group: null,
      language: null,
    });
  });

  it('reads quoted and escaped values and ignores unsupported lines', () => {
    const rules = parseGitAttributes(`
# comment
*.fs linguist-language="F Sharp" group=typed\\ files
!secret/** group=secret
[attr]macro group=macro
`);

    expect(attributesForPath('src/app.fs', rules)).toStrictEqual({
      generated: false,
      group: 'typed files',
      language: 'F Sharp',
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
});
