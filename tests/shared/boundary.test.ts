import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Guard: content scripts must never import credentials (spec §4, §6.4).
 * The credentials module contains the API key, which must stay in chrome.storage.local
 * and never enter the page's renderer process.
 */
describe('boundary', () => {
  it('content scripts do not import from @/shared/credentials', () => {
    const srcDir = join(import.meta.dirname, '../../src')
    const paths = [
      join(srcDir, 'content'),
      join(srcDir, 'entrypoints/content.ts'),
    ]

    const imports = ['@/shared/credentials', './credentials', '../shared/credentials']
    const violations: string[] = []

    for (const path of paths) {
      try {
        if (statSync(path).isDirectory()) {
          walkDir(path, file => {
            if (file.endsWith('.ts') || file.endsWith('.tsx')) {
              const content = require('node:fs').readFileSync(file, 'utf8')
              for (const imp of imports) {
                if (content.includes(`'${imp}'`) || content.includes(`"${imp}"`)) {
                  violations.push(`${file}: imports '${imp}'`)
                }
              }
            }
          })
        } else {
          const content = require('node:fs').readFileSync(path, 'utf8')
          for (const imp of imports) {
            if (content.includes(`'${imp}'`) || content.includes(`"${imp}"`)) {
              violations.push(`${path}: imports '${imp}'`)
            }
          }
        }
      } catch {
        // Path doesn't exist yet, which is fine
      }
    }

    expect(violations).toEqual([])
  })
})

function walkDir(dir: string, callback: (file: string) => void) {
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        walkDir(path, callback)
      } else {
        callback(path)
      }
    }
  } catch {
    // Directory doesn't exist
  }
}
