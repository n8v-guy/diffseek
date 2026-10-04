import { describe, expect, it } from 'vitest';

import {
  assertWithinBudgets,
  defaultLivePerfBudgets,
  generatedIndexedText,
  isExtensionMetadataRequest,
  isInlineStorageState,
  parseInlineStorageState,
  parseStorageCookies,
  type LivePerfMetrics,
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

  it('builds indexed counter text and budget failures', () => {
    expect(generatedIndexedText(86)).toBe('86/86');
    const metrics: LivePerfMetrics = {
      indexingSeconds: 200,
      menuOpenSeconds: 20,
      networkRequests: 50,
      networkUrls: [],
      redraws: 3_000,
      scenario: 'cold',
    };
    expect(assertWithinBudgets(metrics, defaultLivePerfBudgets({}))).toEqual([
      'menuOpenSeconds 20 > 15',
      'indexingSeconds 200 > 120',
      'redraws 3000 > 2000',
      'networkRequests 50 > 40',
    ]);
    expect(
      assertWithinBudgets(
        { ...metrics, scenario: 'warm', networkRequests: 0 },
        defaultLivePerfBudgets({}),
      ).some((failure) => failure.includes('networkRequests')),
    ).toBe(false);
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
