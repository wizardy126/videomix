import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `tsc --build` compiles src/common (tests included) into common-ts-dist. Don't discover those
    // compiled copies, or every test in src/common would also run a second time from the build output.
    // e2e/: the Playwright tests of the app (T33, `yarn test-e2e`), named *.e2e.ts so they don't match anyway.
    exclude: [...configDefaults.exclude, 'common-ts-dist/**', 'e2e/**'],
  },
});
