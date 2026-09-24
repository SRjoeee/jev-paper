import { describe, expect, it } from 'vitest'
import { ARXIV, BAND_COLORS, bandCss, contrast } from '@/content/bands/palette'

describe('band palettes', () => {
  it('measures WCAG contrast exactly', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })

  for (const theme of ['light', 'dark'] as const) {
    it(`${theme}: arXiv body text over every band, filled and hovered, reaches 4.5:1`, () => {
      for (const [tone, [fill, hover]] of Object.entries(BAND_COLORS[theme])) {
        expect(contrast(ARXIV[theme].text, fill), `${theme} ${tone} fill`).toBeGreaterThanOrEqual(4.5)
        expect(contrast(ARXIV[theme].text, hover), `${theme} ${tone} hover`).toBeGreaterThanOrEqual(4.5)
      }
    })
  }

  it('reports links over bands for the owner (spec §13: report, do not repaint)', () => {
    const rows = (['light', 'dark'] as const).flatMap(theme =>
      Object.entries(BAND_COLORS[theme]).map(([tone, [fill]]) => ({ theme, tone, link: contrast(ARXIV[theme].link, fill).toFixed(2), onPage: contrast(ARXIV[theme].link, ARXIV[theme].background).toFixed(2) })),
    )
    console.table(rows)
    expect(rows).toHaveLength(8)
  })

  it('emits both themes as custom properties', () => {
    const css = bandCss()
    expect(css).toContain('[data-theme="light"]')
    expect(css).toContain('--jp-evidence:#ffe58f')
    expect(css).toContain('[data-theme="dark"]')
  })
})
