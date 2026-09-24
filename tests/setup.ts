// Copied from Read arXiv tests/setup.ts@3f3c91f8 (GPL-3.0), 2026-09-24.
// Vitest global setup: Dexie needs IndexedDB, the cache key needs Web Crypto
import 'fake-indexeddb/auto'
import { webcrypto } from 'node:crypto'

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}
