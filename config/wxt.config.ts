import { defineConfig } from 'wxt';

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
    name: 'DiffSeek',
    description: 'A subtle GitHub code-review ergonomics facelift.',
    permissions: ['storage'],
    host_permissions: [
      'https://github.com/*',
      'https://raw.githubusercontent.com/*',
    ],
  },
});
