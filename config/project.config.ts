export const TYPESCRIPT_SOURCE_ROOTS = [
  'config',
  'entrypoints',
  'scripts',
  'src',
  'test',
] as const;

export const TEST_SUFFIXES = [
  '.unit.ts',
  '.spec.ts',
  '.test.ts',
  '.e2e.playwright.ts',
] as const;
