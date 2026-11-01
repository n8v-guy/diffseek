import { readFileSync } from 'node:fs';

import { defineConfig } from 'wxt';

import {
  buildNumber,
  buildNumberEnv,
  gitHeadCount,
  manifestVersion,
  readBuildNumberFile,
} from './manifest-version.ts';

const packageVersion =
  /"version": "([^"]+)"/.exec(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  )?.[1] ?? '0.0.0';

// File before git: the Add-ons source archive has no repository.
const branchCommitCount = buildNumber([
  process.env[buildNumberEnv],
  readBuildNumberFile(),
  gitHeadCount(),
]);

export default defineConfig({
  alias: {
    '@diffseek/app': 'src/app',
    '@diffseek/browser': 'src/adapters/browser',
    '@diffseek/github': 'src/adapters/github',
    '@diffseek/repository-metadata':
      'src/modules/repository-metadata/index.ts',
    '@diffseek/review': 'src/modules/review/index.ts',
  },
  manifestVersion: 3,
  manifest: ({ browser }) => ({
    name: 'DiffSeek for GitHub: cut the noise in big PRs',
    description:
      'Filter one slice at a time, mark it viewed in one click and watch progress fill up. Generated files are hidden and auto-viewed.',
    version: manifestVersion(packageVersion, branchCommitCount),
    permissions: ['storage'],
    host_permissions: [
      'https://github.com/*',
      'https://raw.githubusercontent.com/*',
    ],
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'diffseek@n8v.me',
              strict_min_version: '140.0',
              data_collection_permissions: {
                required: ['none'],
              },
            },
          },
        }
      : {}),
  }),
  zip: {
    artifactTemplate: '{{name}}-{{version}}-{{browser}}.zip',
    sourcesTemplate: '{{name}}-{{version}}-sources.zip',
    excludeSources: [
      'coverage/**',
      'docs/superpowers/**',
      'playwright-report/**',
      'screenshots/**',
      'test-results/**',
    ],
    zipSources: process.env.DIFFSEEK_ZIP_SOURCES === '0' ? false : undefined,
  },
});
