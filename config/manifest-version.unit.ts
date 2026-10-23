import { describe, expect, it } from 'vitest';

import { manifestVersion } from './manifest-version.ts';

describe('manifestVersion', () => {
  it('replaces only the patch segment with the branch commit count', () => {
    expect(manifestVersion('1.0.0', 13)).toBe('1.0.13');
    expect(manifestVersion('2.9.4', 100)).toBe('2.9.100');
  });
});
