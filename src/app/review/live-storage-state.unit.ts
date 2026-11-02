import { describe, expect, it } from 'vitest';

import {
  isInlineStorageState,
  parseInlineStorageState,
  parseStorageCookies,
} from './live-storage-state';

describe('live storageState', () => {
  it('parses storageState cookies and inline JSON secrets', parsesStorageStateCookiesAndInlineJSONSecrets);
});

function parsesStorageStateCookiesAndInlineJSONSecrets(): void {
  expect(isInlineStorageState('{"cookies":[]}')).toBe(true);
  expect(isInlineStorageState('./github-storage.json')).toBe(false);
  expect(parseInlineStorageState('{"cookies":[]}')).toStrictEqual({ cookies: [] });
  expect(
    parseStorageCookies({
      cookies: [
        {
          domain: '.github.com',
          name: 'user_session',
          path: '/',
          sameSite: 'Lax',
          value: 'abc',
        },
      ],
    }),
  ).toStrictEqual([
    {
      domain: '.github.com',
      name: 'user_session',
      path: '/',
      sameSite: 'Lax',
      value: 'abc',
    },
  ]);
  expect(() => parseStorageCookies({ cookies: [{}] })).toThrow(/missing/v);
}
