import { configDefaults, defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

const unitTestFiles = '**/*.{test,spec,unit}.ts';

export default defineConfig({
  plugins: [
    WxtVitest({ configFile: 'config/wxt.config.ts' }),
  ],
  test: {
    coverage: {
      exclude: [
        '.output/**',
        '.wxt/**',
        'entrypoints/**',
        unitTestFiles,
      ],
      reporter: ['text', 'json'],
      thresholds: {
        branches: 85,
        functions: 94,
        lines: 94,
        statements: 92,
      },
    },
    environment: 'jsdom',
    exclude: [...configDefaults.exclude, '**/*.e2e.playwright.ts'],
    include: [unitTestFiles],
  },
});
