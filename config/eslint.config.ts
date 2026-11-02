import { fileURLToPath } from 'node:url';

import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import type { Linter } from 'eslint';
import { defineConfig } from 'eslint/config';
import { configs as deMorganConfigs } from 'eslint-plugin-de-morgan';
import { flatConfigs as importConfigs } from 'eslint-plugin-import-x';
import unsanitized from 'eslint-plugin-no-unsanitized';
import { configs as perfectionistConfigs } from 'eslint-plugin-perfectionist';
import playwright from 'eslint-plugin-playwright';
import promisePlugin from 'eslint-plugin-promise';
import { configs as regexpConfigs } from 'eslint-plugin-regexp';
import { configs as sonarConfigs } from 'eslint-plugin-sonarjs';
import unicornPlugin from 'eslint-plugin-unicorn';
import { configs as tseslintConfigs } from 'typescript-eslint';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const typecheckProjects = [
  './config/tsconfig.modules.json',
  './config/tsconfig.adapters.json',
  './config/tsconfig.app.json',
  './config/tsconfig.tooling.json',
];
const e2eFiles = ['**/*.e2e.playwright.ts'];
const unitFiles = ['**/*.{test,spec,unit}.ts'];
const testOverrides: Linter.RulesRecord = {
  '@typescript-eslint/no-magic-numbers': 'off',
  'max-lines-per-function': [
    'error',
    { max: 100, skipBlankLines: true, skipComments: true },
  ],
  'sonarjs/no-duplicate-string': ['error', { threshold: 10 }],
};

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
  unicornPlugin.configs.recommended,
  regexpConfigs['flat/recommended'],
  promisePlugin.configs['flat/recommended'],
  importConfigs.recommended,
  importConfigs.typescript,
  deMorganConfigs.recommended,
  perfectionistConfigs['recommended-natural'],
  unsanitized.configs.recommended,
  tseslintConfigs.strictTypeChecked,
  tseslintConfigs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: typecheckProjects,
        tsconfigRootDir: repositoryRoot,
      },
    },
    rules: {
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': true }],
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports', prefer: 'type-imports' },
      ],
      '@typescript-eslint/default-param-last': 'error',
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-magic-numbers': ['error', { ignore: [-1, 0, 1] }],
      '@typescript-eslint/no-shadow': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true },
      ],
      '@typescript-eslint/strict-boolean-expressions': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      complexity: ['error', 10],
      eqeqeq: 'error',
      'import-x/first': 'error',
      'import-x/newline-after-import': 'error',
      'import-x/no-deprecated': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/no-empty-named-blocks': 'error',
      'import-x/no-mutable-exports': 'error',
      'import-x/no-self-import': 'error',
      'import-x/no-useless-path-segments': 'error',
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
      'max-depth': ['error', 4],
      'max-lines': [
        'error',
        { max: 512, skipBlankLines: true, skipComments: true },
      ],
      'max-lines-per-function': [
        'error',
        { max: 50, skipBlankLines: true, skipComments: true },
      ],
      'max-nested-callbacks': ['error', 3],
      'max-params': ['error', 4],
      'no-else-return': 'error',
      'no-implicit-coercion': 'error',
      'no-lonely-if': 'error',
      'no-param-reassign': 'error',
      'no-warning-comments': [
        'error',
        {
          location: 'anywhere',
          terms: [
            'c8 ignore',
            'istanbul ignore',
            'jscpd:ignore',
            'type-coverage:ignore',
            'v8 ignore',
          ],
        },
      ],
      'object-shorthand': 'error',
      'perfectionist/sort-import-attributes': 'off',
      'perfectionist/sort-imports': 'off',
      'perfectionist/sort-named-imports': [
        'error',
        { ignoreCase: true, type: 'alphabetical' },
      ],
      'prefer-template': 'error',
      'regexp/require-unicode-sets-regexp': 'error',
      'sonarjs/cognitive-complexity': ['error', 15],
      'sonarjs/no-duplicate-string': ['error', { threshold: 2 }],
      'sonarjs/no-global-this': 'off',
      'sonarjs/no-inverted-boolean-check': 'off',
      'sonarjs/prefer-regexp-exec': 'off',
      'unicorn/consistent-boolean-name': 'off',
      'unicorn/consistent-class-member-order': [
        'error',
        {
          order: [
            'static-field',
            'static-block',
            'static-method',
            'public-field',
            'private-field',
            'constructor',
            'public-method',
            'private-method',
          ],
        },
      ],
      'unicorn/name-replacements': 'off',
      'unicorn/no-asterisk-prefix-in-documentation-comments': 'off',
      'unicorn/no-await-expression-member': 'off',
      'unicorn/no-nested-ternary': 'off',
      'unicorn/no-null': 'off',
      'unicorn/no-unreadable-for-of-expression': 'off',
      'unicorn/no-unsafe-dom-html': 'error',
      'unicorn/no-useless-undefined': 'off',
      'unicorn/numeric-separators-style': 'off',
      // Error.isError needs Chrome 134; no minimum_chrome_version is declared.
      'unicorn/prefer-error-is-error': 'off',
      'unicorn/prefer-global-this': 'off',
      'unicorn/prefer-query-selector': 'off',
      'unicorn/prefer-scoped-selector': 'off',
      'unicorn/prefer-simple-condition-first': 'off',
      'unicorn/prefer-ternary': 'off',
      'unicorn/single-line-block-comment-style': 'off',
      'unicorn/try-complexity': 'error',
    },
    settings: {
      'import-x/resolver': {
        typescript: {
          alwaysTryTypes: true,
          noWarnOnMultipleProjects: true,
          project: typecheckProjects,
        },
      },
    },
  },
  {
    files: ['config/eslint.config.ts'],
    rules: { '@typescript-eslint/no-magic-numbers': 'off' },
  },
  {
    files: ['scripts/store-screenshots/**/*.ts'],
    rules: { '@typescript-eslint/no-magic-numbers': 'off' },
  },
  {
    files: unitFiles,
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      ...testOverrides,
      'vitest/no-conditional-in-test': 'error',
      'vitest/prefer-called-with': 'error',
      'vitest/prefer-strict-equal': 'error',
      'vitest/require-mock-type-parameters': 'error',
      'vitest/require-top-level-describe': 'error',
    },
  },
  {
    files: e2eFiles,
    ...playwright.configs['flat/recommended'],
    rules: {
      ...playwright.configs['flat/recommended'].rules,
      ...testOverrides,
    },
  },
);
