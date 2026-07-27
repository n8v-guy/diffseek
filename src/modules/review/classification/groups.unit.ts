import { describe, expect, it } from 'vitest';

import {
  attributesForPath,
  bundledGitAttributes,
  parseGitAttributes,
} from '@diffseek/repository-metadata';

import { extensionOf } from './groups';

describe('extensionOf', () => {
  it('returns the final lower-case suffix', () => {
    expect(extensionOf('src/Component.TEST.TS')).toBe('.ts');
  });

  it('returns null for extensionless files and dotfiles', () => {
    expect(extensionOf('LICENSE')).toBeNull();
    expect(extensionOf('.gitignore')).toBeNull();
  });
});

describe('groups', () => {
  const rules = parseGitAttributes(bundledGitAttributes);

  it('ships instant conventional groups', () => {
    expect(attributesForPath('src/app.test.ts', rules).group).toBe('Tests');
    expect(
      attributesForPath(
        'src/github/review-app.e2e.playwright.ts',
        rules,
      ).group,
    ).toBe('Tests');
    expect(attributesForPath('docs/guide.md', rules).group).toBe('Docs');
    expect(attributesForPath('config/app.json', rules).group).toBe('Config');
  });

  it('covers component tests and conventional tool configuration', () => {
    expect(
      attributesForPath(
        'gen/componentTest/rides/DriverBlockingComponentTest.ts',
        rules,
      ).group,
    ).toBe('Tests');
    expect(
      attributesForPath('common/rides/tsconfig.json', rules).group,
    ).toBe('Config');
    expect(
      attributesForPath('common/rides/.eslintrc.js', rules).group,
    ).toBe('Config');
  });
});
