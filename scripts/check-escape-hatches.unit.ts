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
    expect(findEscapeHatches('src/app/review/review-app.ts', text)).toStrictEqual([
      'src/app/review/review-app.ts:2',
      'src/app/review/review-app.ts:3',
    ]);
  });

  it('flags file-level type suppressions', () => {
    expect(
      findEscapeHatches('src/a.ts', `// ${expectedOff}\n// ${fileOff}`),
    ).toStrictEqual(['src/a.ts:1', 'src/a.ts:2']);
  });

  it('accepts source that does not suppress a check', () => {
    expect(findEscapeHatches('src/a.ts', 'const value = true;\n')).toStrictEqual([]);
  });

  it('flags coverage, stylesheet, and clone suppressions', () => {
    const coverage = ['c8', 'ignore next'].join(' ');
    const stylesheet = ['stylelint', 'disable'].join('-');
    const clone = ['jscpd', 'ignore start'].join(':');
    const text = [`// ${coverage}`, `/* ${stylesheet} */`, `/* ${clone} */`].join(
      '\n',
    );
    expect(findEscapeHatches('src/a.ts', text)).toStrictEqual([
      'src/a.ts:1',
      'src/a.ts:2',
      'src/a.ts:3',
    ]);
  });
});
