import { defineConfig } from 'vitest/config'
import { WxtVitest } from 'wxt/testing/vitest-plugin'

// WxtVitest: in-memory extension APIs (fakeBrowser), auto-imports, the @/ alias
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'happy-dom',
    environmentOptions: {
      happyDOM: {
        settings: {
          disableCSSFileLoading: true,
          disableJavaScriptFileLoading: true,
          disableJavaScriptEvaluation: true,
          handleDisabledFileLoadingAsSuccess: true,
          navigation: { disableMainFrameNavigation: true },
        },
      },
    },
    // eval/**/*.test.ts (the live regression gate) is collected only under `pnpm eval:regress`, which sets
    // JEV_REGRESS=1 — never under plain `pnpm test`, so a developer with JEV_KEY exported never pays for it by
    // accident. The offline scorer/mapper tests live under tests/eval/ and are always collected. (Task 15)
    include: process.env.JEV_REGRESS === '1' ? ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'eval/**/*.test.ts'] : ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    passWithNoTests: true,
    testTimeout: 30_000,
    // Remote fixtures are downloaded and verified once, before the first test file
    globalSetup: ['tests/global-setup.ts'],
    // fake-indexeddb for Dexie, Web Crypto for hashing
    setupFiles: ['tests/setup.ts'],
  },
})
