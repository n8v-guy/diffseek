import { configDefaults, defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

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
        '**/*.{test,spec,unit}.ts',
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
    include: ['**/*.{test,spec,unit}.ts'],
    exclude: [...configDefaults.exclude, '**/*.e2e.playwright.ts'],
  },
});
