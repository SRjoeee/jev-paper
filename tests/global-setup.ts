// Copied from Read arXiv tests/global-setup.ts@3f3c91f8 (GPL-3.0), 2026-09-24.
import { ensureFixtures } from '../scripts/fetch-fixtures.mjs'

// Before any test file runs: the fixtures that are not in the repository are present and verified (scripts/fetch-fixtures.mjs).
// A failure here fails the run — a suite that skipped five papers in silence would report coverage it does not have.
// In watch mode vitest keeps a failed global setup for the rest of the session: restart it after fetching
export default async function setup(): Promise<void> {
  const { downloaded } = await ensureFixtures({ log: line => console.log(`[fixtures] ${line}`) })
  if (downloaded.length > 0) console.log(`[fixtures] ${downloaded.length} downloaded and verified; they stay on disk for the next run`)
}
