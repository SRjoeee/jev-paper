// Copied from Read arXiv tests/setup.ts@3f3c91f8 (GPL-3.0), 2026-09-24.
// Vitest global setup: Dexie needs IndexedDB, the cache key needs Web Crypto
import 'fake-indexeddb/auto'
import { webcrypto } from 'node:crypto'
import { fakeBrowser } from 'wxt/testing/fake-browser'

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}

// The interface follows Chrome's UI language (src/shared/lang.ts). The suites run in Chinese, the default they
// assert; tests/english/ switches a file to English before its imports. fakeBrowser.reset() leaves i18n alone.
fakeBrowser.i18n.getUILanguage = () => 'zh-CN'
