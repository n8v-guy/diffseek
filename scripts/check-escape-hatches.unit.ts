import { describe, expect, it } from 'vitest';

import { findEscapeHatches } from './check-escape-hatches';

const lintOff = ['eslint', 'disable'].join('-');
const typeOff = ['@ts', 'ignore'].join('-');
const expectedOff = ['@ts', 'expect-error'].join('-');
const fileOff = ['@ts', 'nocheck'].join('-');

describe('escape hatches', () => {
  it('flags lint and type suppressions', () => {
    const text = [
      'const ok = true;',
      `// ${lintOff}-next-line no-magic`,
      `/* ${typeOff} */`,
    ].join('\n');
    expect(findEscapeHatches('src/app/review/review-app.ts', text)).toEqual([
      'src/app/review/review-app.ts:2',
      'src/app/review/review-app.ts:3',
    ]);
  });

  it('flags file-level type suppressions', () => {
    expect(
      findEscapeHatches('src/a.ts', `// ${expectedOff}\n// ${fileOff}`),
    ).toEqual(['src/a.ts:1', 'src/a.ts:2']);
  });

  it('accepts source that does not suppress a check', () => {
    expect(findEscapeHatches('src/a.ts', 'const value = true;\n')).toEqual([]);
  });
});
