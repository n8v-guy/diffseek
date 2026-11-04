import { describe, expect, it } from 'vitest';

import {
  actionFailures,
  defaultLivePerfBudgets,
  emptyGithubRequestCounts,
  generatedCategorizedPattern,
  generatedIndexedText,
  isExtensionMetadataRequest,
  isGeneratedCategorized,
  isInlineStorageState,
  livePerfSummary,
  median,
  hotLossFailures,
  medianBudgetFailures,
  medianSample,
  noteGithubRequest,
  parseInlineStorageState,
  parseStorageCookies,
  rebuildFailures,
  type LivePerfSample,
} from './live-perf.support';

describe('live-perf helpers', () => {
  it('counts github.com search, raw metadata, and other requests', () => {
    const counts = emptyGithubRequestCounts();
    noteGithubRequest(counts, 'https://github.com/search?type=code&q=repo%3Aa%2Fb');
    noteGithubRequest(
      counts,
      'https://github.com/sha-tm/diffseek-test-data/raw/HEAD/.gitattributes',
    );
    noteGithubRequest(
      counts,
      'https://github.com/sha-tm/diffseek-test-data/blob/HEAD/docs/CODEOWNERS',
    );
    noteGithubRequest(
      counts,
      'https://raw.githubusercontent.com/sha-tm/diffseek-test-data/HEAD/.github/CODEOWNERS',
    );
    noteGithubRequest(
      counts,
      'https://github.com/sha-tm/diffseek-test-data/pull/1/commits',
    );
    noteGithubRequest(counts, 'https://example.test/raw/HEAD/.gitattributes');
    expect(counts).toEqual({ total: 5, search: 1, metadata: 3, other: 1 });
  });

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
      treeRowsReadded: 0,
      panelsReadded: 0,
      treeNetLoss: 0,
      panelNetLoss: 0,
      requests: { total: 9, search: 1, metadata: 4, other: 4 },
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
      requests: { total: 3, search: 0, metadata: 0, other: 3 },
    };
    const middle = medianSample([slow, fast, fast]);
    expect(middle.firstRenderSeconds).toBe(4);
    expect(middle.requests).toEqual({ total: 3, search: 0, metadata: 0, other: 3 });
    expect(rebuildFailures(slow, defaultLivePerfBudgets({}))).toEqual([]);
    expect(
      rebuildFailures({ ...slow, panelRebuilds: 1 }, defaultLivePerfBudgets({})),
    ).toEqual([]);
    expect(
      rebuildFailures({ ...fast, panelRebuilds: 2 }, defaultLivePerfBudgets({})),
    ).toEqual(['cold panelRebuilds 2 > 1']);
    expect(rebuildFailures({ ...slow, scenario: 'warm' }, defaultLivePerfBudgets({}))).toEqual(
      [],
    );
    expect(
      rebuildFailures({ ...slow, scenario: 'warm', panelRebuilds: 1 }, defaultLivePerfBudgets({})),
    ).toEqual([]);
    expect(actionFailures('mark-viewed', { ...fast, treeRebuilds: 1 }, defaultLivePerfBudgets({}))).toEqual([
      'mark-viewed treeRebuilds 1 > 0',
    ]);
    expect(hotLossFailures({ ...slow, scenario: 'hot' })).toEqual([]);
    expect(hotLossFailures({ ...slow, scenario: 'hot', panelNetLoss: 4 })).toEqual([
      'hot panelNetLoss 4 > 0',
    ]);
    expect(medianBudgetFailures([], defaultLivePerfBudgets({}))).toEqual([
      'no samples',
    ]);
    expect(medianBudgetFailures([slow, slow, slow], defaultLivePerfBudgets({}))).toEqual([
      'cold firstRenderSeconds 50 > 12',
      'cold menuOpenSeconds 20 > 6',
      'cold panelsSeconds 100 > 16',
      'cold reconciles 800 > 500',
      'cold domMutations 20000 > 12000',
    ]);
    const summary = livePerfSummary({
      prUrl: 'https://example.test',
      cold: [fast],
      warm: [fast],
      hot: [fast],
    });
    expect(summary).toContain('tree rebuilds');
    expect(summary).toContain('| cold | 3 | 0 | 0 | 3 |');
  });

  it('parses storageState cookies and inline JSON secrets', () => {
    expect(isInlineStorageState('{"cookies":[]}')).toBe(true);
    expect(isInlineStorageState('github-storage.json')).toBe(false);
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
