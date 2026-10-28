import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { defineConfig } from 'wxt';

import { manifestVersion } from './manifest-version.ts';

const packageVersion =
  /"version": "([^"]+)"/.exec(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  )?.[1] ?? '0.0.0';

const branchCommitCount = Number(
  execFileSync('git', ['rev-list', '--count', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
);

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
  manifest: {
    name: 'DiffSeek: auto-hide PR noise + rich filters for GitHub',
    description:
      'Fast, lightweight GitHub PR filter by file groups, formats and CODEOWNERS. Focus on one slice, mark folders viewed at once.',
    version: manifestVersion(packageVersion, branchCommitCount),
    permissions: ['storage'],
    host_permissions: [
      'https://github.com/*',
      'https://raw.githubusercontent.com/*',
    ],
  },
  zip: {
    artifactTemplate: '{{name}}-{{version}}-{{browser}}.zip',
  },
});
