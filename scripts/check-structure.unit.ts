import { describe, expect, it } from 'vitest';

import { findStructureViolations } from './check-structure';

describe('repository structure', () => {
  it('accepts configured product, test, tooling, and documentation roots', () => {
    expect(
      findStructureViolations([
        'entrypoints/background.ts',
        'src/app/review/review-app.ts',
        'src/app/review/review-app.spec.ts',
        'src/app/review/review-app.e2e.playwright.ts',
        'config/eslint.config.ts',
        'config/project.config.ts',
        'scripts/check-structure.ts',
        'scripts/check-structure.unit.ts',
      ]),
    ).toEqual([]);
  });

  it('rejects a colocated test without its namesake module', () => {
    expect(
      findStructureViolations(['src/app/orphan.spec.ts']),
    ).toEqual([
      'src/app/orphan.spec.ts: missing namesake module src/app/orphan.ts',
    ]);
  });

  it('rejects tracked superpowers planning artifacts', () => {
    expect(
      findStructureViolations([
        'README.md',
        'docs/superpowers/plans/generated-plan.md',
      ]),
    ).toEqual([
      'docs/superpowers/plans/generated-plan.md: generated planning artifact is tracked',
    ]);
  });

  it('rejects TypeScript outside configured roots and unsupported test names', () => {
    expect(
      findStructureViolations([
        'eslint.config.ts',
        'tests/e2e/diffseek.spec.ts',
        'utilities/helper.ts',
        'src/app/review-app.tests.ts',
      ]),
    ).toEqual([
      'eslint.config.ts: TypeScript is outside configured roots',
      'src/app/review-app.tests.ts: unsupported test suffix',
      'tests/e2e/diffseek.spec.ts: TypeScript is outside configured roots',
      'utilities/helper.ts: TypeScript is outside configured roots',
    ]);
  });

  it('rejects a tooling test without its adjacent namesake module', () => {
    expect(
      findStructureViolations(['scripts/orphan.unit.ts']),
    ).toEqual([
      'scripts/orphan.unit.ts: missing namesake module scripts/orphan.ts',
    ]);
  });

  it('rejects source files outside the app, modules, and adapters layers', () => {
    expect(
      findStructureViolations([
        'src/domain/file.ts',
        'src/github/page-adapter.ts',
        'src/metadata/reader.ts',
      ]),
    ).toEqual([
      'src/domain/file.ts: source is outside an architectural layer',
      'src/github/page-adapter.ts: source is outside an architectural layer',
      'src/metadata/reader.ts: source is outside an architectural layer',
    ]);
  });
});
