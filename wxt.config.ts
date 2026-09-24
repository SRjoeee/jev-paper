import { defineConfig } from 'wxt'
import { DEFAULT_LOCALE, localeFiles } from './scripts/locales'

// JEV_E2E=1 builds the copy the end-to-end suite loads: its own output directory, and a host permission for the
// local fake Jev server (tests/e2e). A release build never carries it.
const e2e = process.env.JEV_E2E === '1'

export default defineConfig({
  srcDir: 'src',
  outDir: e2e ? '.output-e2e' : '.output',
  modules: ['@wxt-dev/module-react'],
  // modulepreload in extension pages triggers Chrome's "cross-world extension resource mismatch" warning
  vite: () => ({ build: { modulePreload: false } }),
  manifest: {
    // Localised through Chrome's _locales, which the hook below writes from src/shared/copy.ts
    name: '__MSG_name__',
    description: '__MSG_description__',
    default_locale: DEFAULT_LOCALE,
    // The code's own floor is Chrome 116: every Jev request combines its abort and its timeout with AbortSignal.any
    // (116); scrollend (114), oklch() (111), :has() (105) and the rotate/scale properties (104) are older. 128 is
    // kept above that because nothing older than it has been run, and the bundled libraries' floors are not audited.
    minimum_chrome_version: '128',
    permissions: ['storage'],
    host_permissions: ['https://openrouter.ai/*', 'https://api.typesafe.ai/*', ...(e2e ? ['http://127.0.0.1/*'] : [])],
    // A custom endpoint's origin is requested at runtime from the popup (chrome.permissions.request)
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    action: { default_title: 'JevPaper' },
  },
  hooks: {
    'build:publicAssets': (_, files) => {
      files.push(...localeFiles())
    },
  },
})
