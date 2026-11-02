import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'wxt';

import { manifestVersion } from './manifest-version.ts';

const packageVersion =
  /"version": "([^"]+)"/v.exec(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  )?.[1] ?? '0.0.0';

const branchCommitCount = Number(
  process.env.DIFFSEEK_BUILD_NUMBER ??
    execFileSync('git', ['rev-list', '--count', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
);

export default defineConfig({
  manifest: ({ browser }) => ({
    description:
      'Filter one slice at a time, mark it viewed in one click and watch progress fill up. Generated files are hidden and auto-viewed.',
    host_permissions: [
      'https://github.com/*',
      'https://raw.githubusercontent.com/*',
    ],
    minimum_chrome_version: '122',
    name: 'DiffSeek for GitHub: cut the noise in big PRs',
    permissions: ['storage'],
    version: manifestVersion(packageVersion, branchCommitCount),
    ...(browser === 'firefox' && {
      browser_specific_settings: {
        gecko: {
          data_collection_permissions: {
            required: ['none'],
          },
          id: 'diffseek@n8v.me',
          strict_min_version: '140.0',
        },
        gecko_android: { strict_min_version: '142.0' },
      },
    }),
  }),
  manifestVersion: 3,
  vite: () => ({ resolve: { tsconfigPaths: true } }),
  zip: {
    artifactTemplate: '{{name}}-{{version}}-{{browser}}.zip',
    zipSources: false,
  },
});
