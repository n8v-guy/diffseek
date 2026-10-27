import { describe, expect, it } from 'vitest';

import {
  defaultLivePerfBudgets,
  generatedCategorizedPattern,
  generatedIndexedText,
  isExtensionMetadataRequest,
  isGeneratedCategorized,
  isInlineStorageState,
  livePerfSummary,
  median,
  medianBudgetFailures,
  medianSample,
  parseInlineStorageState,
  parseStorageCookies,
  rebuildFailures,
  type LivePerfSample,
} from './live-perf.helpers';

describe('live-perf helpers', () => {
  it('recognizes extension metadata fetches only', () => {
    expect(
      isExtensionMetadataRequest(
        'https://github.com/sha-tm/diffseek-test-data/pull/1/commits',
      ),
    ).toBe(true);
    expect(
      isExtensionMetadataRequest(
        'https://github.com/sha-tm/diffseek-test-data/raw/main/.gitattributes',
      ),
    ).toBe(true);
    expect(
      isExtensionMetadataRequest(
        'https://raw.githubusercontent.com/sha-tm/diffseek-test-data/HEAD/CODEOWNERS',
      ),
    ).toBe(true);
    expect(
      isExtensionMetadataRequest(
        'https://github.com/sha-tm/diffseek-test-data/pull/1/files',
      ),
    ).toBe(false);
  });

  it('treats generated denominator as categorized-ready', () => {
    expect(generatedIndexedText(86)).toBe('86/86');
    expect(generatedCategorizedPattern(86).test('86/86')).toBe(true);
    expect(generatedCategorizedPattern(86).test('12/86')).toBe(true);
    expect(generatedCategorizedPattern(86).test('86/85')).toBe(false);
    expect(isGeneratedCategorized(' 40/86 ', 86)).toBe(true);
    expect(isGeneratedCategorized('86/87', 86)).toBe(false);
  });

  it('budgets median durations and rejects any tree rebuild', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 4])).toBe(2.5);
    const slow: LivePerfSample = {
      scenario: 'cold',
      firstRenderSeconds: 50,
      menuOpenSeconds: 20,
      panelsSeconds: 100,
      reconciles: 800,
      domMutations: 20_000,
      treeRebuilds: 1,
      panelRebuilds: 0,
      treeRowsRemoved: 284,
      panelsRemoved: 0,
    };
    const fast: LivePerfSample = {
      ...slow,
      firstRenderSeconds: 4,
      menuOpenSeconds: 1,
      panelsSeconds: 8,
      reconciles: 12,
      domMutations: 400,
      treeRebuilds: 0,
      treeRowsRemoved: 0,
    };
    expect(medianSample([slow, fast, fast]).firstRenderSeconds).toBe(4);
    expect(rebuildFailures(slow, defaultLivePerfBudgets({}))).toEqual([
      'cold treeRebuilds 1 > 0',
    ]);
    expect(medianBudgetFailures([], defaultLivePerfBudgets({}))).toEqual([
      'no samples',
    ]);
    expect(medianBudgetFailures([slow, slow, slow], defaultLivePerfBudgets({}))).toEqual([
      'cold firstRenderSeconds 50 > 12',
      'cold menuOpenSeconds 20 > 6',
      'cold panelsSeconds 100 > 45',
      'cold reconciles 800 > 500',
      'cold domMutations 20000 > 12000',
    ]);
    expect(livePerfSummary({ prUrl: 'https://example.test', cold: [fast], warm: [fast], hot: [fast] })).toContain(
      'tree rebuilds',
    );
  });

  it('parses storageState cookies and inline JSON secrets', () => {
    expect(isInlineStorageState('{"cookies":[]}')).toBe(true);
    expect(isInlineStorageState('/tmp/github-storage.json')).toBe(false);
    expect(parseInlineStorageState('{"cookies":[]}')).toEqual({ cookies: [] });
    expect(
      parseStorageCookies({
        cookies: [
          {
            name: 'user_session',
            value: 'abc',
            domain: '.github.com',
            path: '/',
            sameSite: 'Lax',
          },
        ],
      }),
    ).toEqual([
      {
        name: 'user_session',
        value: 'abc',
        domain: '.github.com',
        path: '/',
        expires: undefined,
        httpOnly: undefined,
        secure: undefined,
        sameSite: 'Lax',
      },
    ]);
    expect(() => parseStorageCookies({ cookies: [{}] })).toThrow(/missing/);
  });
});
