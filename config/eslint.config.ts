import { fileURLToPath } from 'node:url';

import js from '@eslint/js';
import {
  configs as commentConfigs,
  rules as commentRules,
} from '@eslint-community/eslint-plugin-eslint-comments';
import vitest from '@vitest/eslint-plugin';
import { defineConfig } from 'eslint/config';
import { configs as deMorganConfigs } from 'eslint-plugin-de-morgan';
import { flatConfigs as importConfigs } from 'eslint-plugin-import-x';
import { configs as perfectionistConfigs } from 'eslint-plugin-perfectionist';
import promisePlugin from 'eslint-plugin-promise';
import { configs as regexpConfigs } from 'eslint-plugin-regexp';
import { configs as sonarConfigs } from 'eslint-plugin-sonarjs';
import unicornPlugin from 'eslint-plugin-unicorn';
import { configs as tseslintConfigs } from 'typescript-eslint';

const testFiles = [
  '**/*.{test,spec,unit}.ts',
  '**/*.e2e.playwright.ts',
];
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const typecheckProjects = [
  './config/tsconfig.modules.json',
  './config/tsconfig.adapters.json',
  './config/tsconfig.app.json',
  './config/tsconfig.tooling.json',
];
const maxCognitiveComplexity = 15;
const maxComplexity = 10;
const maxDepth = 4;
const maxFileLines = 512;
const maxFunctionLines = 50;
const maxNestedCallbacks = 3;
const maxParameters = 4;
const maxTestFunctionLines = 100;
const duplicateStringThreshold = 2;
const testDuplicateStringThreshold = 10;
const commentPluginName = '@eslint-community/eslint-comments';

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
  js.configs.recommended,
  sonarConfigs.recommended,
  unicornPlugin.configs.recommended,
  regexpConfigs['flat/recommended'],
  promisePlugin.configs['flat/recommended'],
  importConfigs.recommended,
  importConfigs.typescript,
  {
    plugins: {
      [commentPluginName]: { rules: commentRules },
    },
    rules: {
      ...commentConfigs.recommended.rules,
      [`${commentPluginName}/no-unused-disable`]: 'error',
      [`${commentPluginName}/no-use`]: 'error',
    },
  },
  deMorganConfigs.recommended,
  perfectionistConfigs['recommended-natural'],
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
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports', prefer: 'type-imports' },
      ],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-magic-numbers': ['error', { ignore: [-1, 0, 1] }],
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/require-await': 'error',
      complexity: ['error', maxComplexity],
      'import-x/no-cycle': 'error',
      'import-x/no-duplicates': 'error',
      'import-x/no-extraneous-dependencies': [
        'error',
        { devDependencies: true, packageDir: repositoryRoot },
      ],
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
      'max-depth': ['error', maxDepth],
      'max-lines': [
        'error',
        { max: maxFileLines, skipBlankLines: true, skipComments: true },
      ],
      'max-lines-per-function': [
        'error',
        { max: maxFunctionLines, skipBlankLines: true, skipComments: true },
      ],
      'max-nested-callbacks': ['error', maxNestedCallbacks],
      'max-params': ['error', maxParameters],
      'max-statements-per-line': ['error', { max: 1 }],
      'perfectionist/sort-import-attributes': 'off',
      'perfectionist/sort-imports': 'off',
      'perfectionist/sort-named-imports': 'off',
      'sonarjs/cognitive-complexity': ['error', maxCognitiveComplexity],
      'sonarjs/no-duplicate-string': [
        'error',
        { threshold: duplicateStringThreshold },
      ],
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
    extends: [tseslintConfigs.disableTypeChecked],
    files: ['config/eslint.config.ts'],
  },
  {
    files: testFiles,
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      '@typescript-eslint/no-magic-numbers': 'off',
      'max-lines-per-function': [
        'error',
        {
          max: maxTestFunctionLines,
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      'sonarjs/no-duplicate-string': [
        'error',
        { threshold: testDuplicateStringThreshold },
      ],
    },
  },
);
