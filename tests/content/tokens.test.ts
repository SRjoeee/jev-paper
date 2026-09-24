import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BAND_COLORS, contrast } from '@/content/bands/palette'

const css = readFileSync(join(import.meta.dirname, '../../src/shared/tokens.css'), 'utf8')

/** Parses `--jp-name: #hex;` declarations out of one theme's CSS block */
function tokensOf(block: string): Record<string, string> {
  const tokens: Record<string, string> = {}
  for (const [, name, hex] of block.matchAll(/--jp-([\w-]+):\s*(#[0-9a-fA-F]{3,8});/g)) tokens[name!] = hex!
  return tokens
}

describe('tokens.css', () => {
  const [light, dark] = css.split('[data-theme="dark"]')

  it('uses the band hover colours as the legend swatches, in both themes', () => {
    for (const [tone, [, hover]] of Object.entries(BAND_COLORS.light)) expect(light).toContain(`--jp-${tone}: ${hover};`)
    for (const [tone, [, hover]] of Object.entries(BAND_COLORS.dark)) expect(dark).toContain(`--jp-${tone}: ${hover};`)
  })

  describe('contrast', () => {
    const themes = { light: tokensOf(light!), dark: tokensOf(dark!) }
    for (const [name, t] of Object.entries(themes)) {
      it(`meets WCAG floors in ${name} theme`, () => {
        for (const pair of [
          ['text', 'surface'],
          ['text-muted', 'surface'],
          ['tip-fg', 'tip-bg'],
          ['on-ink', 'ink'],
          ['on-accent', 'accent'],
        ] as const) expect(contrast(t[pair[0]]!, t[pair[1]]!), `${pair[0]} on ${pair[1]}`).toBeGreaterThanOrEqual(4.5)
        for (const role of ['accent', 'danger'] as const) expect(contrast(t[role]!, t.surface!), `${role} on surface`).toBeGreaterThanOrEqual(3)
      })
    }
  })
})
