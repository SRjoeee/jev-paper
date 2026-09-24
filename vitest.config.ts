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
    // eval/*.test.ts are skipped unless JEV_KEY and the experiment's data are present (Task 15)
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx', 'eval/**/*.test.ts'],
    passWithNoTests: true,
    testTimeout: 30_000,
  },
})
