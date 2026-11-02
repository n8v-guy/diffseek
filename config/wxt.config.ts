import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { defineConfig } from 'wxt';

import { manifestVersion } from './manifest-version.ts';

const packageVersion =
  /"version": "([^"]+)"/.exec(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  )?.[1] ?? '0.0.0';

const branchCommitCount = Number(
  process.env.DIFFSEEK_BUILD_NUMBER ??
    execFileSync('git', ['rev-list', '--count', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
);

export default defineConfig({
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
              strict_min_version: '142.0',
              data_collection_permissions: {
                required: ['none'],
              },
            },
          },
        }
      : {}),
  }),
  vite: () => ({ resolve: { tsconfigPaths: true } }),
  zip: {
    artifactTemplate: '{{name}}-{{version}}-{{browser}}.zip',
    zipSources: false,
  },
});
