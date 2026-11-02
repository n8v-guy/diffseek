import { describe, expect, it } from 'vitest';

import {
  actionFailures,
  defaultLivePerfBudgets,
  generatedCategorizedPattern,
  generatedIndexedText,
  hotLossFailures,
  isExtensionMetadataRequest,
  isGeneratedCategorized,
  type LivePerfSample,
  livePerfSummary,
  median,
  medianBudgetFailures,
  medianSample,
  rebuildFailures,
} from './live-perf.helpers';

describe('live-perf helpers', () => {
  it('recognizes extension metadata fetches only', recognizesExtensionMetadataFetchesOnly);
  it('treats generated denominator as categorized-ready', treatsGeneratedDenominatorAsCategorizedReady);
  it('budgets median durations and rejects any tree rebuild', budgetsMedianDurationsAndRejectsAnyTreeRebuild);
});

function budgetsMedianDurationsAndRejectsAnyTreeRebuild(): void {
  expect(median([3, 1, 2])).toBe(2);
  expect(median([1, 4])).toBe(2.5);
  const slow: LivePerfSample = {
    domMutations: 20_000,
    firstRenderSeconds: 50,
    menuOpenSeconds: 20,
    panelNetLoss: 0,
    panelRebuilds: 0,
    panelsReadded: 0,
    panelsRemoved: 0,
    panelsSeconds: 100,
    reconciles: 800,
    scenario: 'cold',
    treeNetLoss: 0,
    treeRebuilds: 1,
    treeRowsReadded: 0,
    treeRowsRemoved: 284,
  };
  const fast: LivePerfSample = {
    ...slow,
    domMutations: 400,
    firstRenderSeconds: 4,
    menuOpenSeconds: 1,
    panelsSeconds: 8,
    reconciles: 12,
    treeRebuilds: 0,
    treeRowsRemoved: 0,
  };
  expect(medianSample([slow, fast, fast]).firstRenderSeconds).toBe(4);
  expect(rebuildFailures(slow, defaultLivePerfBudgets({}))).toStrictEqual([
    'cold panelRebuilds 0 !== 1',
  ]);
  expect(
    rebuildFailures({ ...slow, panelRebuilds: 1 }, defaultLivePerfBudgets({})),
  ).toStrictEqual([]);
  expect(
    rebuildFailures({ ...fast, panelRebuilds: 2 }, defaultLivePerfBudgets({})),
  ).toStrictEqual(['cold treeRebuilds 0 !== 1', 'cold panelRebuilds 2 !== 1']);
  expect(rebuildFailures({ ...slow, scenario: 'warm' }, defaultLivePerfBudgets({}))).toStrictEqual([
    'warm panelRebuilds 0 !== 1',
  ]);
  expect(
    rebuildFailures({ ...slow, panelRebuilds: 1, scenario: 'warm' }, defaultLivePerfBudgets({})),
  ).toStrictEqual([]);
  expect(actionFailures('mark-viewed', { ...fast, treeRebuilds: 1 }, defaultLivePerfBudgets({}))).toStrictEqual([
    'mark-viewed treeRebuilds 1 > 0',
  ]);
  expect(hotLossFailures({ ...slow, scenario: 'hot' })).toStrictEqual([]);
  expect(hotLossFailures({ ...slow, panelNetLoss: 4, scenario: 'hot' })).toStrictEqual([
    'hot panelNetLoss 4 > 0',
  ]);
  expect(medianBudgetFailures([], defaultLivePerfBudgets({}))).toStrictEqual([
    'no samples',
  ]);
  expect(medianBudgetFailures([slow, slow, slow], defaultLivePerfBudgets({}))).toStrictEqual([
    'cold firstRenderSeconds 50 > 12',
    'cold menuOpenSeconds 20 > 6',
    'cold panelsSeconds 100 > 16',
    'cold reconciles 800 > 500',
    'cold domMutations 20000 > 12000',
  ]);
  expect(livePerfSummary({ cold: [fast], hot: [fast], prUrl: 'https://example.test', warm: [fast] })).toContain(
    'tree rebuilds',
  );
}

function recognizesExtensionMetadataFetchesOnly(): void {
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
}

function treatsGeneratedDenominatorAsCategorizedReady(): void {
  expect(generatedIndexedText(86)).toBe('86/86');
  expect(generatedCategorizedPattern(86).test('86/86')).toBe(true);
  expect(generatedCategorizedPattern(86).test('12/86')).toBe(true);
  expect(generatedCategorizedPattern(86).test('86/85')).toBe(false);
  expect(isGeneratedCategorized(' 40/86 ', 86)).toBe(true);
  expect(isGeneratedCategorized('86/87', 86)).toBe(false);
}
