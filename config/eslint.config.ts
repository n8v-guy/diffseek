import { fileURLToPath } from 'node:url';

import { fixupPluginRules } from '@eslint/compat';
import js from '@eslint/js';
import vitest from '@vitest/eslint-plugin';
import importPlugin from 'eslint-plugin-import';
import sonarjs from 'eslint-plugin-sonarjs';
import tseslint from 'typescript-eslint';

const testFiles = [
  '**/*.{test,spec,unit}.ts',
  '**/*.e2e.playwright.ts',
];
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

export default tseslint.config(
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
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: [
          './config/tsconfig.modules.json',
          './config/tsconfig.adapters.json',
          './config/tsconfig.app.json',
          './config/tsconfig.tooling.json',
        ],
        tsconfigRootDir: repositoryRoot,
      },
    },
    settings: {
      'import/resolver': {
        typescript: {
          noWarnOnMultipleProjects: true,
          project: [
            './config/tsconfig.modules.json',
            './config/tsconfig.adapters.json',
            './config/tsconfig.app.json',
            './config/tsconfig.tooling.json',
          ],
        },
      },
    },
    plugins: {
      import: fixupPluginRules(importPlugin),
      sonarjs,
    },
    rules: {
      ...importPlugin.flatConfigs.recommended.rules,
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { fixStyle: 'inline-type-imports', prefer: 'type-imports' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      complexity: ['error', 25],
      'import/no-cycle': 'error',
      'import/no-duplicates': 'error',
      'import/order': [
        'error',
        {
          alphabetize: { caseInsensitive: true, order: 'asc' },
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          'newlines-between': 'always',
        },
      ],
      'max-depth': ['error', 4],
      'max-lines': [
        'error',
        { max: 420, skipBlankLines: true, skipComments: true },
      ],
      'max-lines-per-function': [
        'error',
        { max: 220, skipBlankLines: true, skipComments: true },
      ],
      'max-nested-callbacks': ['error', 4],
      'max-params': ['error', 5],
      'sonarjs/cognitive-complexity': ['error', 20],
      'sonarjs/no-duplicate-string': ['error', { threshold: 4 }],
    },
  },
  {
    files: testFiles,
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      '@typescript-eslint/require-await': 'off',
      'max-lines': 'off',
      'max-lines-per-function': [
        'error',
        { max: 450, skipBlankLines: true, skipComments: true },
      ],
      'sonarjs/no-duplicate-string': 'off',
    },
  },
);
