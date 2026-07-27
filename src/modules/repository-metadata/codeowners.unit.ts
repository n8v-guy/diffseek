import { describe, expect, it } from 'vitest';

import {
  ownersForPath,
  parseCodeowners,
} from './codeowners';

const rules = parseCodeowners(`
# global fallback
* @global-1 @global-2
*.js @javascript # inline comment
**/logs @logs
/build/logs/ @build
docs/* docs@example.com
apps/ @apps
/apps/github
`);

describe('CODEOWNERS', () => {
  it('uses the last matching rule and multiple owners', () => {
    expect(ownersForPath('src/app.ts', rules)).toEqual([
      '@global-1',
      '@global-2',
    ]);
    expect(ownersForPath('src/app.js', rules)).toEqual(['@javascript']);
  });

  it('implements root, directory, and non-recursive wildcard semantics', () => {
    expect(ownersForPath('build/logs/app.txt', rules)).toEqual(['@build']);
    expect(ownersForPath('nested/build/logs/app.txt', rules)).toEqual([
      '@logs',
    ]);
    expect(ownersForPath('docs/guide.md', rules)).toEqual(['docs@example.com']);
    expect(ownersForPath('docs/deep/guide.md', rules)).toEqual([
      '@global-1',
      '@global-2',
    ]);
    expect(ownersForPath('nested/apps/app.ts', rules)).toEqual(['@apps']);
    expect(ownersForPath('src/logs/app.txt', rules)).toEqual(['@logs']);
  });

  it('supports ownerless overrides and case-sensitive paths', () => {
    expect(ownersForPath('apps/github/app.ts', rules)).toEqual([]);
    expect(ownersForPath('APPS/github/app.ts', rules)).toEqual([
      '@global-1',
      '@global-2',
    ]);
  });

  it('skips syntax GitHub documents as invalid', () => {
    const parsed = parseCodeowners(`
!secret/** @negated
file[0-9].ts @range
\\#literal @escaped
valid/** @valid
`);

    expect(parsed).toHaveLength(1);
    expect(ownersForPath('valid/app.ts', parsed)).toEqual(['@valid']);
  });
});
