import { defineConfig } from '@playwright/test';

// End-to-end tests of the real Electron app (T33). Local only (not in CI): `yarn test-e2e` (see
// docs/videomix/06-entorno-desarrollo.md). They drive the production build in `out/` (run `yarn build` first), so
// vitest never sees them (its default include only matches *.test.ts / *.spec.ts under the project, and this folder is
// excluded in vitest.config.ts).
export default defineConfig({
  testDir: '.',
  testMatch: '*.e2e.ts',
  outputDir: '../test-results/e2e',
  // One Electron app at a time: the scenarios share an app and a project within a file, and renders are CPU-heavy
  workers: 1,
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure',
  },
});
