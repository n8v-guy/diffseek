import { rmSync, writeFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildNumber,
  buildNumberFile,
  gitHeadCount,
  manifestVersion,
  readBuildNumberFile,
} from './manifest-version.ts';

describe('manifestVersion', () => {
  it('replaces only the patch segment with the branch commit count', () => {
    expect(manifestVersion('1.0.0', 13)).toBe('1.0.13');
    expect(manifestVersion('2.9.4', 100)).toBe('2.9.100');
  });
});

describe('buildNumber', () => {
  it('uses the first non-empty source', () => {
    expect(buildNumber(['7', '8', '9'])).toBe(7);
    expect(buildNumber([undefined, '8\n', '9'])).toBe(8);
    expect(buildNumber(['', '  ', ' 3 '])).toBe(3);
    expect(buildNumber(['0'])).toBe(0);
  });

  it('rejects a missing or non-integer source', () => {
    expect(() => buildNumber([undefined, ''])).toThrow(/non-negative integer/);
    expect(() => buildNumber(['1.2'])).toThrow(/non-negative integer/);
    expect(() => buildNumber(['12a'])).toThrow(/non-negative integer/);
  });
});

describe('build number file', () => {
  it('reads build-number when it is present', () => {
    writeFileSync(buildNumberFile, '15\n');
    try {
      expect(readBuildNumberFile()).toBe('15\n');
    } finally {
      rmSync(buildNumberFile);
    }
    expect(readBuildNumberFile()).toBeUndefined();
  });
});

describe('gitHeadCount', () => {
  it('counts commits on this checkout', () => {
    expect(gitHeadCount()?.trim()).toMatch(/^\d+$/);
  });
});
