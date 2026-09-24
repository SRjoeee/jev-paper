import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BAND_COLORS } from '@/content/bands/palette'

describe('tokens.css', () => {
  const css = readFileSync(join(import.meta.dirname, '../../src/shared/tokens.css'), 'utf8')
  it('uses the band hover colours as the legend swatches, in both themes', () => {
    const [light, dark] = css.split('[data-theme="dark"]')
    for (const [tone, [, hover]] of Object.entries(BAND_COLORS.light)) expect(light).toContain(`--jp-${tone}: ${hover};`)
    for (const [tone, [, hover]] of Object.entries(BAND_COLORS.dark)) expect(dark).toContain(`--jp-${tone}: ${hover};`)
  })
})
