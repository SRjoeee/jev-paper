import { defineConfig } from 'wxt'

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
    name: 'JevPaper',
    description: '打开 arXiv 论文，重点自动标出来。',
    // caretPositionFromPoint (hit testing) needs Chrome 128
    minimum_chrome_version: '128',
    permissions: ['storage'],
    host_permissions: ['https://openrouter.ai/*', 'https://api.typesafe.ai/*', ...(e2e ? ['http://127.0.0.1/*'] : [])],
    // A custom endpoint's origin is requested at runtime from the popup (chrome.permissions.request)
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    action: { default_title: 'JevPaper' },
  },
})
