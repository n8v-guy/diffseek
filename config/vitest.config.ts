import { configDefaults, defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

const unitTestFiles = '**/*.{test,spec,unit}.ts';

export default defineConfig({
  plugins: [
    WxtVitest({ configFile: 'config/wxt.config.ts' }),
  ],
  resolve: { tsconfigPaths: true },
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
        branches: 70,
        functions: 75,
        lines: 75,
        statements: 75,
      },
    },
    environment: 'jsdom',
    include: [unitTestFiles],
    exclude: [...configDefaults.exclude, '**/*.e2e.playwright.ts'],
  },
});
