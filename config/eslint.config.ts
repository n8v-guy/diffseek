import { fileURLToPath } from 'node:url';

import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import { defineConfig } from 'eslint/config';
import { flatConfigs as importConfigs } from 'eslint-plugin-import-x';
import playwright from 'eslint-plugin-playwright';
import { configs as sonarConfigs } from 'eslint-plugin-sonarjs';
import { configs as tseslintConfigs } from 'typescript-eslint';

import { TEST_SUFFIXES } from './project.config.ts';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const suffixFiles = TEST_SUFFIXES.map((suffix) => `**/*${suffix}`);
const productFiles = ['entrypoints/**/*.ts', 'src/**/*.ts'];
const unitFiles = suffixFiles.filter(
  (pattern) => pattern !== '**/*.e2e.playwright.ts',
);
const e2eFiles = ['**/*.e2e.playwright.ts'];
const testFiles = [
  ...suffixFiles,
  '**/*.fixture.ts',
  '**/*.support.ts',
  '**/fixtures/**',
  'config/**',
  'scripts/**',
];

export default defineConfig(
  {
    ignores: [
      '**/.output/**',
      '**/.cache/**',
      '**/.wxt/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  { linterOptions: { noInlineConfig: true } },
  js.configs.recommended,
  sonarConfigs.recommended,
  importConfigs.recommended,
  importConfigs.typescript,
  tseslintConfigs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: repositoryRoot,
      },
    },
    rules: {
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': true },
      ],
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports', prefer: 'type-imports' },
      ],
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-shadow': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // A partial options object replaces the strict preset and restores the rule defaults.
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        {
          allowAny: false,
          allowBoolean: false,
          allowNever: false,
          allowNullish: false,
          allowNumber: true,
          allowRegExp: false,
        },
      ],
      '@typescript-eslint/strict-boolean-expressions': [
        'error',
        {
          allowNullableBoolean: true,
          allowNullableNumber: true,
          allowNullableString: true,
        },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      complexity: 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'import-x/first': 'error',
      'import-x/newline-after-import': 'error',
      'import-x/order': [
        'error',
        {
          alphabetize: { caseInsensitive: true, order: 'asc' },
          groups: [
            'builtin',
            'external',
            'internal',
            'parent',
            'sibling',
            'index',
          ],
          'newlines-between': 'always',
        },
      ],
      'max-depth': 'error',
      'max-nested-callbacks': 'error',
      'sonarjs/cognitive-complexity': 'off',
      'sonarjs/no-all-duplicated-branches': 'off',
      'sonarjs/prefer-regexp-exec': 'off',
    },
  },
  {
    files: productFiles,
    ignores: testFiles,
    rules: {
      'max-lines': [
        'error',
        { max: 500, skipBlankLines: true, skipComments: true },
      ],
      'max-lines-per-function': [
        'error',
        { max: 120, skipBlankLines: true, skipComments: true },
      ],
      'max-params': ['error', 5],
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          ignore: [-1, 0, 1, 2],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          ignoreEnums: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
        },
      ],
      'sonarjs/no-duplicate-string': 'error',
    },
  },
  {
    files: testFiles,
    rules: {
      '@typescript-eslint/require-await': 'off',
      'sonarjs/no-os-command-from-path': 'off',
    },
  },
  {
    files: unitFiles,
    plugins: { vitest },
    rules: { ...vitest.configs.recommended.rules },
  },
  {
    ...playwright.configs['flat/recommended'],
    files: e2eFiles,
  },
);
