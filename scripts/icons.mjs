// Renders the toolbar and store icons: Lucide's highlighter (ISC) in dark ink on a highlighter-yellow squircle.
// The stroke thickens slightly at 16 and 32 px to stay legible (spec §7).
// PATHS is a literal copy of src/shared/icon.ts's HIGHLIGHTER_PATHS: this plain Node script can't import
// through the @/ alias. tests/guide/guide.test.tsx asserts the two stay identical.
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const PATHS = '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>'
const html = size => {
  const radius = Math.round(size * 0.24)
  const glyph = Math.round(size * 0.66)
  const stroke = size <= 16 ? 2.4 : size <= 32 ? 2.2 : 2
  return `<html><body style="margin:0;background:transparent"><div id="icon" style="width:${size}px;height:${size}px;border-radius:${radius}px;display:grid;place-items:center;background:linear-gradient(160deg,#ffe36e,#ffd23a)"><svg width="${glyph}" height="${glyph}" viewBox="0 0 24 24" fill="none" stroke="#1f2630" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${PATHS}</svg></div></body></html>`
}

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 1 })
await mkdir('public/icon', { recursive: true })
for (const size of [16, 32, 48, 128]) {
  await page.setContent(html(size))
  await page.locator('#icon').screenshot({ path: `public/icon/${size}.png`, omitBackground: true })
}
await browser.close()
console.log('public/icon/{16,32,48,128}.png written')
