// End-to-end: the built extension (pnpm build:e2e) in Chromium, arXiv pages served from fixtures, arXiv's own
// assets from the network, Jev from a local fake. No key, no cost. Run: pnpm e2e
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { chromium } from 'playwright'
import { startFakeJev } from './fake-jev.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const EXT = join(ROOT, '.output-e2e/chrome-mv3')
/** Screenshots for a reader to look at (git-ignored) */
const SHOTS = join(ROOT, 'test-results/e2e')
mkdirSync(SHOTS, { recursive: true })
// 2608.30667 is a LaTeXML page without an abstract
const PAGES = { '1706.03762': 'jev/1706.03762v7.html', '2312.17141': 'arxiv/2312.17141.html', '2410.00260': 'arxiv/2410.00260.html', '2608.30667': 'arxiv/2608.30667.html' }
const BANDS = '.jevpaper-bands > i'

const jev = await startFakeJev()
const context = await chromium.launchPersistentContext(await mkdtemp(join(tmpdir(), 'jevpaper-e2e-')), {
  channel: 'chromium',
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  // Playwright turns the back/forward cache off; a reader's Chrome has it on, and going back to a paper restores it
  ignoreDefaultArgs: ['--disable-back-forward-cache'],
  viewport: { width: 1280, height: 900 },
})
// The network is closed except for arxiv.org's own assets (Ruling 4) and the fake Jev on 127.0.0.1
const blocked = new Set()
await context.route('**/*', route => {
  const url = new URL(route.request().url())
  if (url.protocol === 'chrome-extension:' || url.hostname === '127.0.0.1') return route.continue()
  if (url.protocol === 'https:' && url.hostname === 'arxiv.org') {
    const m = url.pathname.match(/^\/html\/([^/]+?)\/?$/)
    if (m && PAGES[m[1]]) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: readFileSync(join(ROOT, 'tests/fixtures', PAGES[m[1]]), 'utf8') })
    // Somewhere else on arXiv to navigate to: an abstract page, as a tiny local body
    if (url.pathname.startsWith('/abs/')) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>abs</title><p>An abstract page.</p>' })
    return route.continue()
  }
  blocked.add(url.origin)
  return route.abort()
})
// Anything the extension logs as a warning or an error is a finding, whichever scenario it happens in
const logged = []
const listen = (where, target) =>
  target.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning') {
      const at = m.location().url ?? ''
      if (where === 'service worker' || at.startsWith('chrome-extension://')) logged.push(`${where}: [${m.type()}] ${m.text()}`)
    }
  })
context.on('page', page => listen('page', page))
let [worker] = context.serviceWorkers()
if (!worker) worker = await context.waitForEvent('serviceworker')
listen('service worker', worker)
const extensionId = new URL(worker.url()).host

// Settings (content-readable) and credentials (service worker and popup only) are separate items (Ruling 9);
// every seed bumps keyStamp, as saving credentials in the popup does. Both are WXT `version: 1` items without
// migrations, which read the raw value and never look at the `settings$` / `credentials$` meta keys.
let stamp = 0
const seed = (settings = {}, credentials = {}) =>
  worker.evaluate(
    ({ s, c }) => chrome.storage.local.set({ settings: s, credentials: c }),
    {
      s: { version: 1, level: 1, guideSeen: true, bubbleSeen: true, keyStamp: ++stamp, ...settings },
      c: { version: 1, provider: 'custom', baseUrl: jev.url, model: 'jev', apiKey: 'k', ...credentials },
    },
  )
const bands = (page, tone) => page.evaluate(([sel, t]) => document.querySelectorAll(t ? `${sel}[data-tone="${t}"]` : sel).length, [BANDS, tone])
/** The abstract in the middle of the viewport: on 1706.03762 it starts below the fold, and arXiv's sticky header
 *  covers whatever `scrollIntoView()` puts at the very top */
const showAbstract = page => page.evaluate(() => document.querySelector('.ltx_abstract').scrollIntoView({ block: 'center', behavior: 'instant' }))
const hasBands = page => page.waitForFunction(sel => document.querySelectorAll(sel).length > 0, BANDS, { timeout: 20_000 })
async function open(id, before) {
  const page = await context.newPage()
  if (before) await page.addInitScript(before)
  await page.goto(`https://arxiv.org/html/${id}`)
  await hasBands(page)
  return page
}

/** One pixel of the rendered page, as [r, g, b]: a 1 × 1 screenshot is one PNG row, and a lone pixel is unfiltered */
async function pixel(page, x, y) {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 } })
  let at = 8
  let channels = 3
  const data = []
  while (at < png.length) {
    const length = png.readUInt32BE(at)
    const type = png.toString('ascii', at + 4, at + 8)
    if (type === 'IHDR') channels = { 2: 3, 6: 4 }[png[at + 17]]
    if (type === 'IDAT') data.push(png.subarray(at + 8, at + 8 + length))
    at += 12 + length
  }
  const row = inflateSync(Buffer.concat(data))
  return [...row.subarray(1, 1 + Math.min(3, channels))]
}

/** Whether the first band of a tone shows its own colour on screen: sampled on its top row, above the glyphs */
async function bandShows(page, tone) {
  const at = await page.evaluate(sel => {
    const el = document.querySelector(sel)
    el.scrollIntoView({ block: 'center', behavior: 'instant' })
    const b = el.getBoundingClientRect()
    return { xs: [0.2, 0.35, 0.5, 0.65, 0.8].map(f => Math.round(b.left + b.width * f)), y: Math.floor(b.top) + 1, color: getComputedStyle(el).backgroundColor }
  }, `${BANDS}[data-tone="${tone}"]`)
  const want = at.color.match(/\d+/g).slice(0, 3).map(Number)
  const seen = []
  for (const x of at.xs) seen.push(await pixel(page, x, at.y))
  const hits = seen.filter(p => p.every((v, i) => Math.abs(v - want[i]) <= 2)).length
  return { hits, of: at.xs.length, want: at.color, seen }
}

/** The extension's own isolated world on a page, through CDP: what the content script itself holds */
async function contentWorld(page) {
  const cdp = await context.newCDPSession(page)
  const worlds = []
  cdp.on('Runtime.executionContextCreated', e => worlds.push(e.context))
  await cdp.send('Runtime.enable')
  const world = worlds.find(c => c.auxData?.type === 'isolated' && c.origin === `chrome-extension://${extensionId}`)
  assert.ok(world, `no JevPaper isolated world among ${worlds.map(c => `${c.name}|${c.origin}|${c.auxData?.type}`).join(', ')}`)
  return {
    /** Runs `fn` over every live object of the content script's world whose prototype chain holds `proto` */
    async overObjects(proto, fn) {
      const { result } = await cdp.send('Runtime.evaluate', { expression: proto, contextId: world.id })
      const { objects } = await cdp.send('Runtime.queryObjects', { prototypeObjectId: result.objectId })
      const out = await cdp.send('Runtime.callFunctionOn', { objectId: objects.objectId, functionDeclaration: fn.toString(), returnByValue: true })
      if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description ?? out.exceptionDetails.text)
      return out.result.value
    },
    detach: () => cdp.detach(),
  }
}

const results = []
const notes = []
async function scenario(name, fn) {
  const before = new Set(context.pages())
  const t0 = performance.now()
  try {
    await fn()
    results.push(['PASS', name, null, performance.now() - t0])
  } catch (error) {
    results.push(['FAIL', name, error.message, performance.now() - t0])
    const last = context.pages().filter(p => !before.has(p)).at(-1)
    await last?.screenshot({ path: join(SHOTS, `fail-${results.length}.png`) }).catch(() => {})
  }
  // Every scenario starts from the same browser: no tab of an earlier one keeps repainting or holding a run
  for (const page of context.pages()) if (!before.has(page)) await page.close().catch(() => {})
}

await scenario('bands appear; a reload and a second tab ask Jev nothing more', async () => {
  await seed({})
  jev.state.requests = 0
  jev.state.bodies = []
  const page = await open('1706.03762')
  const first = jev.state.requests
  assert.ok(first > 0)
  assert.deepEqual(jev.state.unknown, [], 'the engine asked a question key the fake does not know')
  assert.ok(jev.state.auth.every(a => a === 'Bearer k'), 'every request carries the key')
  assert.ok((await bands(page, 'claim')) > 0 && (await bands(page, 'evidence')) > 0, 'claims and their evidence are painted')
  const shows = await bandShows(page, 'evidence')
  assert.ok(shows.hits >= 3, `an evidence band is not visible on screen: want ${shows.want}, saw ${JSON.stringify(shows.seen)}`)
  await page.screenshot({ path: join(SHOTS, 'light.png') })
  await page.reload()
  await hasBands(page)
  assert.equal(jev.state.requests, first, 'reload')
  await open('1706.03762')
  assert.equal(jev.state.requests, first, 'second tab')
})

await scenario('two tabs opened at once share one run', async () => {
  jev.state.bodies = []
  await Promise.all([open('2312.17141'), open('2312.17141')])
  assert.ok(jev.state.bodies.length > 0, 'the paper was not computed here')
  assert.equal(new Set(jev.state.bodies).size, jev.state.bodies.length, 'a request body was sent twice')
})

await scenario('levels switch without asking again', async () => {
  const page = await open('1706.03762')
  const before = await bands(page)
  const asked = jev.state.requests
  await page.locator('jevpaper-ui .fab').click()
  await page.locator('jevpaper-ui .row').nth(1).click()
  await page.waitForFunction(([sel, n]) => document.querySelectorAll(sel).length > n, [BANDS, before])
  assert.ok((await bands(page, 'caveat')) > 0, 'level 2 paints the caveats')
  assert.equal(jev.state.requests, asked)
  await page.keyboard.press('Escape')
  await seed({ level: 1 })
})

await scenario('interaction A: a claim jumps to its evidence, the tip jumps back', async () => {
  const page = await open('1706.03762')
  await showAbstract(page)
  const claim = await page.evaluate(sel => {
    const b = document.querySelector(`${sel}[data-tone="claim"]`).getBoundingClientRect()
    return { x: b.left + 40, y: b.top + b.height / 2 }
  }, BANDS)
  const y0 = await page.evaluate(() => scrollY)
  // Spec §5.4, "Scrolling hides the tip": sample every frame of the jump for a tip still showing while the page moves
  await page.evaluate(() => {
    window.__tipFrames = { run: 0, longest: 0 }
    let lastY = scrollY
    const frame = () => {
      const moving = scrollY !== lastY
      lastY = scrollY
      const shown = !!document.querySelector('jevpaper-ui').shadowRoot.querySelector('.tip')
      const t = window.__tipFrames
      t.run = moving && shown ? t.run + 1 : 0
      t.longest = Math.max(t.longest, t.run)
      if (!window.__stopTipFrames) requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  })
  await page.mouse.click(claim.x, claim.y)
  await page.waitForFunction(y => Math.abs(scrollY - y) > 50, y0, { timeout: 5000 })
  // The landing pulse runs on the evidence's own bands — a scripted animation, not the hover colour's CSS transition
  await page.waitForFunction(sel => [...document.querySelectorAll(`${sel}[data-tone="evidence"]`)].some(el => el.getAnimations().some(a => !(a instanceof CSSTransition))), BANDS, { timeout: 3000 })
  // A long jump outlasts the spec's 1.2 s fallback (Chrome's smooth scroll over ~17,000 px takes ~1.5 s), so the pulse
  // can start before the scroll lands: wait for the landing itself, the evidence in view and the scroll at rest
  await page.waitForFunction(
    sel => {
      window.__still = window.__lastY === scrollY ? (window.__still ?? 0) + 1 : 0
      window.__lastY = scrollY
      return window.__still >= 3 && [...document.querySelectorAll(`${sel}[data-tone="evidence"]`)].some(e => e.getBoundingClientRect().top > 0 && e.getBoundingClientRect().bottom < innerHeight)
    },
    BANDS,
    { timeout: 5000 },
  )
  const tipFrames = await page.evaluate(() => {
    window.__stopTipFrames = true
    return window.__tipFrames.longest
  })
  // One frame may pass before the first scroll event (a hover already queued for that frame is dropped by it)
  assert.ok(tipFrames <= 1, `a tip stayed up for ${tipFrames} frames while the page scrolled`)
  const ev = await page.evaluate(sel => {
    const b = [...document.querySelectorAll(`${sel}[data-tone="evidence"]`)].map(e => e.getBoundingClientRect()).find(b => b.top > 0 && b.bottom < innerHeight)
    return { x: b.left + 40, y: b.top + b.height / 2 }
  }, BANDS)
  await page.mouse.move(ev.x, ev.y)
  // Hovering the evidence shows its tip (a tip for whatever sat under the resting pointer may come first)
  const tip = page.locator('jevpaper-ui .tip')
  await page
    .waitForFunction(() => /兑现摘要第 .+ 条/.test(document.querySelector('jevpaper-ui').shadowRoot.querySelector('.tip')?.textContent ?? ''), null, { timeout: 3000 })
    .catch(async () => assert.fail(`the evidence tip did not show; the tip reads ${JSON.stringify(await tip.textContent({ timeout: 100 }).catch(() => null))}`))
  const y1 = await page.evaluate(() => scrollY)
  await tip.click()
  await page.waitForFunction(y => scrollY < y - 50, y1, { timeout: 5000 })
})

await scenario('keyboard: an anchor jumps to the evidence and focus follows', async () => {
  const page = await open('1706.03762')
  await page.locator('jevpaper-anchors .anchor').first().focus()
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.querySelector('jevpaper-anchors').shadowRoot.activeElement?.getAttribute('aria-label')?.startsWith('证据'), null, { timeout: 5000 })
})

await scenario('a click that ends a selection does not jump', async () => {
  const page = await open('1706.03762')
  await showAbstract(page)
  const box = await page.evaluate(sel => {
    const b = document.querySelector(`${sel}[data-tone="claim"]`).getBoundingClientRect()
    return { x: b.left + 5, y: b.top + b.height / 2, w: b.width }
  }, BANDS)
  const y0 = await page.evaluate(() => scrollY)
  await page.evaluate(() => {
    window.__clicks = 0
    addEventListener('click', () => window.__clicks++, true)
  })
  await page.mouse.move(box.x, box.y)
  await page.mouse.down()
  await page.mouse.move(box.x + Math.min(200, box.w - 10), box.y, { steps: 5 })
  await page.mouse.up()
  assert.ok(await page.evaluate(() => !getSelection().isCollapsed), 'the drag selected text')
  assert.equal(await page.evaluate(() => window.__clicks), 1, 'the drag ended in a click')
  // Nothing to wait for when nothing should happen: give a jump longer than it takes to start (one frame), then look
  await page.waitForTimeout(800)
  assert.equal(await page.evaluate(() => scrollY), y0)
})

await scenario('bands follow a resize', async () => {
  const page = await open('1706.03762')
  const claimBands = () => page.evaluate(sel => [...document.querySelectorAll(`${sel}[data-tone="claim"]`)].map(el => el.style.cssText).join('|'), BANDS)
  // Abstract text at the centre of every claim band, by the text's own line boxes: at narrow widths arXiv's
  // transparent, fixed table-of-contents panel covers the right of the column, so a hit test there finds the panel
  const onText = sel => {
    const lines = []
    const walker = document.createTreeWalker(document.querySelector('.ltx_abstract'), NodeFilter.SHOW_TEXT)
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const range = document.createRange()
      range.selectNodeContents(n)
      lines.push(...range.getClientRects())
    }
    return [...document.querySelectorAll(`${sel}[data-tone="claim"]`)].every(el => {
      const b = el.getBoundingClientRect()
      const [x, y] = [b.left + b.width / 2, b.top + b.height / 2]
      return lines.some(r => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
    })
  }
  assert.ok(await page.evaluate(onText, BANDS), 'before resize')
  const wide = await claimBands()
  await page.setViewportSize({ width: 860, height: 900 })
  await page.waitForFunction(([sel, old]) => [...document.querySelectorAll(`${sel}[data-tone="claim"]`)].map(el => el.style.cssText).join('|') !== old, [BANDS, wide], { timeout: 5000 })
  // The page may settle in more than one relayout (resize, then the body's ResizeObserver): wait for the end state
  await page.waitForFunction(onText, BANDS, { timeout: 5000 }).catch(() => assert.fail('after resize'))
})

await scenario("painted marks' ranges hold their sentences' text (from the content script's own world)", async () => {
  const page = await open('1706.03762')
  const world = await contentWorld(page)
  // The content script's own PageUnits object, found among its world's live objects: its units and their Ranges
  const r = await world.overObjects('Object.prototype', function () {
    const squash = s => s.replace(/[\s\u00a0]+/g, ' ').replace(/ ([,.;:)\]])/g, '$1').replace(/([([]) /g, '$1').trim()
    const MATH = 'math, table.ltx_equation, table.ltx_eqn_table, .ltx_equationgroup'
    const NOTES = '.ltx_note, .ltx_note_mark, .ltx_note_type'
    const withoutMath = s => squash(s.replace(/\$[^$]*\$|\[equation\]|\[math\]/g, ' '))
    // The unit-text rules of src/content/units.ts read off the live DOM: a formula is a blank here (the unit's `$tex$`
    // is blanked the same way before comparing), a footnote inside the sentence says nothing, TeX is never text
    const walk = range => {
      const root = range.commonAncestorContainer.nodeType === 3 ? range.commonAncestorContainer.parentElement : range.commonAncestorContainer
      const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let out = ''
      let lastMath = null
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        if (!range.intersectsNode(n)) continue
        const el = n.parentElement
        const math = el.closest(MATH)
        if (math) {
          if (math !== lastMath) out += ' '
          lastMath = math
          continue
        }
        const note = el.closest(NOTES)
        if (note && note !== root && !note.contains(root)) continue
        out += n.data.slice(n === range.startContainer ? range.startOffset : 0, n === range.endContainer ? range.endOffset : n.data.length)
      }
      return out
    }
    const page = this.find(o => o && o.ranges instanceof Map && Array.isArray(o.units))
    if (!page) return null
    const out = { units: page.units.length, walkEqual: 0, walkDiff: [], abstract: [], plain: 0, rawEqual: 0, rawDiff: [], math: 0, mathWithTex: 0, texHidden: true, mathSample: null }
    for (const u of page.units) {
      const ranges = page.ranges.get(u.sid) ?? []
      const walked = withoutMath(ranges.map(walk).join(' '))
      const equal = walked === withoutMath(u.text)
      if (equal) out.walkEqual++
      else if (out.walkDiff.length < 5) out.walkDiff.push({ sid: u.sid, unit: u.text, walked })
      if (u.kind === 'abstract') out.abstract.push({ sid: u.sid, equal })
      // Range.toString() itself, which happy-dom could not answer (tests/content/units.test.ts)
      const raw = ranges.map(range => range.toString()).join(' ')
      if (!/\$|\[equation\]|\[math\]/.test(u.text)) {
        out.plain++
        if (squash(raw) === u.text) out.rawEqual++
        else if (out.rawDiff.length < 3) out.rawDiff.push({ sid: u.sid, unit: u.text, raw: squash(raw) })
        continue
      }
      out.math++
      const annotations = ranges.flatMap(range => [...(range.commonAncestorContainer.parentElement ?? range.commonAncestorContainer).querySelectorAll('annotation, annotation-xml')].filter(a => range.intersectsNode(a)))
      if (annotations.some(a => a.checkVisibility())) out.texHidden = false
      const tex = annotations.map(a => a.textContent.trim()).filter(Boolean)
      if (tex.length && tex.every(t => raw.includes(t))) {
        out.mathWithTex++
        out.mathSample ??= { sid: u.sid, unit: u.text, raw: squash(raw) }
      }
    }
    return out
  })
  await world.detach()
  assert.ok(r, 'no PageUnits object in the content script world')
  notes.push(`ranges on 1706.03762: ${r.walkEqual}/${r.units} units' ranges walk to exactly their text (maths blanked); Range.toString() equals the text for ${r.rawEqual}/${r.plain} maths-free units, and for ${r.mathWithTex}/${r.math} units with maths it includes the TeX of <annotation>, which ${r.texHidden ? 'is not rendered' : 'IS rendered'}`)
  if (r.mathSample) notes.push(`  e.g. ${r.mathSample.sid}: unit "${r.mathSample.unit.slice(0, 100)}" / toString "${r.mathSample.raw.slice(0, 130)}"`)
  for (const d of r.rawDiff) notes.push(`  toString differs ${d.sid}: unit "${d.unit.slice(-90)}" / toString "${d.raw.slice(-150)}"`)
  for (const d of r.walkDiff) notes.push(`  WALK DIFFERS ${d.sid}: unit "${d.unit.slice(0, 120)}" / walked "${d.walked.slice(0, 120)}"`)
  // Every abstract sentence is a claim here (the fake answers P(background) 0.1), so every one of them is painted
  assert.deepEqual(r.abstract.filter(a => !a.equal), [], 'a painted claim whose ranges do not hold its sentence')
  assert.equal(r.walkEqual, r.units, `${r.units - r.walkEqual} units whose ranges do not hold their text`)
})

await scenario('back and forward: one UI, one band layer, no new request', async () => {
  const page = await open('1706.03762')
  await page.evaluate(() => addEventListener('pageshow', e => (window.__restored = e.persisted)))
  const asked = jev.state.requests
  const one = async label => {
    const r = await page.evaluate(sel => ({ ui: document.querySelectorAll('jevpaper-ui').length, anchors: document.querySelectorAll('jevpaper-anchors').length, layers: document.querySelectorAll('.jevpaper-bands').length, bands: document.querySelectorAll(sel).length, restored: window.__restored ?? null }), BANDS)
    assert.deepEqual([r.ui, r.anchors, r.layers], [1, 1, 1], `${label}: ${JSON.stringify(r)}`)
    assert.ok(r.bands > 0, `${label}: no bands`)
    return r
  }
  await page.goto('https://arxiv.org/html/2312.17141')
  await hasBands(page)
  await one('B')
  // A page restored from the back/forward cache fires no `load`: wait for the commit, then for the bands
  await page.goBack({ waitUntil: 'commit' })
  await hasBands(page)
  const back = await one('back to A')
  const why = back.restored ? null : await page.evaluate(() => JSON.stringify(performance.getEntriesByType('navigation')[0]?.notRestoredReasons ?? null))
  assert.match(page.url(), /1706\.03762/)
  await page.goForward({ waitUntil: 'commit' })
  await hasBands(page)
  await one('forward to B')
  assert.equal(jev.state.requests, asked, 'Jev was asked again')
  notes.push(`back/forward: A came back ${back.restored ? 'from the back/forward cache (the same content script instance, still painted)' : `as a fresh load (the content script ran again, answered from the cache); not restored because ${why}`}`)
})

/** Round-two question keys (src/background/engine/pipeline.ts): a run that reached them got past round one */
const roundTwo = () => jev.state.bodies.filter(b => /"(?:pk|vf|ql|wk)_/.test(b)).length
const fabState = page => page.evaluate(() => document.querySelector('jevpaper-ui')?.shadowRoot.querySelector('.fab')?.dataset.state ?? null)
/** Waits until `test()` holds, polling every 50 ms, or fails with `what` */
async function until(test, what, ms = 8000) {
  const t0 = Date.now()
  while (!(await test())) {
    if (Date.now() - t0 > ms) assert.fail(`timed out: ${what}`)
    await new Promise(r => setTimeout(r, 50))
  }
}

await scenario('navigating away mid-run aborts the run; coming back from the back/forward cache asks again', async () => {
  // A model id no earlier scenario used, so nothing is cached for it; Jev holds every answer
  await seed({}, { model: 'jev-away' })
  jev.state.hold = true
  jev.state.cancelled = 0
  jev.state.bodies = []
  const start = jev.state.requests
  try {
    const page = await context.newPage()
    await page.addInitScript(() => addEventListener('pageshow', e => (window.__restored = e.persisted)))
    await page.goto('https://arxiv.org/html/1706.03762')
    await until(() => jev.parked() > 0, 'the run reached Jev')
    assert.equal(await fabState(page), 'computing')
    await page.goto('https://arxiv.org/abs/1706.03762')
    // Spec §6.1: the page's port closes, and after the 2 s grace the run is aborted: its requests are cancelled
    await until(() => jev.parked() === 0, 'the pending requests were cancelled')
    const sent = jev.state.requests - start
    assert.ok(jev.state.cancelled > 0 && jev.state.cancelled === sent, `${jev.state.cancelled} of ${sent} requests cancelled`)
    jev.release()
    await new Promise(r => setTimeout(r, 1000))
    assert.equal(jev.state.requests - start, sent, 'the run sent more requests after the tab left')
    assert.equal(roundTwo(), 0, 'the run reached round two')
    // Back: the page comes from the back/forward cache with its request closed, and asks again (Jev answers now)
    await page.goBack({ waitUntil: 'commit' })
    await hasBands(page)
    assert.equal(await page.evaluate(() => window.__restored), true, 'the paper did not come back from the back/forward cache')
    assert.ok(jev.state.requests - start > sent, 'the restored page did not ask again')
  } finally {
    jev.release()
    await seed({})
  }
})

await scenario('a reload mid-run rejoins the run: nothing is cancelled or asked twice', async () => {
  await seed({}, { model: 'jev-reload' })
  jev.state.hold = true
  jev.state.cancelled = 0
  jev.state.bodies = []
  try {
    const page = await context.newPage()
    // arXiv's own assets would make the reload's timing depend on the network; this scenario needs none of them
    await page.route(url => url.hostname === 'arxiv.org' && !url.pathname.startsWith('/html/'), route => route.abort())
    await page.goto('https://arxiv.org/html/1706.03762')
    await until(() => jev.parked() > 0, 'the run reached Jev')
    await page.reload({ waitUntil: 'commit' })
    // Past the grace period: the reloaded page connected again for the same run, so nothing was aborted
    await new Promise(r => setTimeout(r, 3000))
    assert.equal(jev.state.cancelled, 0, 'the reload aborted the run')
    jev.release()
    await hasBands(page)
    assert.equal(jev.state.cancelled, 0)
    assert.equal(new Set(jev.state.bodies).size, jev.state.bodies.length, 'a request body was sent twice')
  } finally {
    jev.release()
    await seed({})
  }
})

await scenario('dark theme: the dark palette, readable body text, nothing opaque above the band layer', async () => {
  const page = await open('1706.03762', () => localStorage.setItem('ar5iv_theme', 'dark'))
  const r = await page.evaluate(sel => {
    const lum = c => {
      const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const text = getComputedStyle(document.querySelector('.ltx_abstract .ltx_p')).color
    const band = getComputedStyle(document.querySelector(`${sel}[data-tone="evidence"]`)).backgroundColor
    const [hi, lo] = [lum(text), lum(band)].sort((a, b) => b - a)
    const opaque = []
    for (let el = document.querySelector('.ltx_abstract'); el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      const bg = getComputedStyle(el).backgroundColor
      if (!/rgba\(0, 0, 0, 0\)|transparent/.test(bg)) opaque.push(`${el.tagName}.${el.className}: ${bg}`)
    }
    return { theme: document.querySelector('.jevpaper-bands').dataset.theme, html: document.documentElement.dataset.theme, ratio: (hi + 0.05) / (lo + 0.05), text, band, opaque }
  }, BANDS)
  await page.screenshot({ path: join(SHOTS, 'dark.png') })
  assert.equal(r.html, 'dark', "arXiv's own theme switch did not run")
  assert.equal(r.theme, 'dark')
  assert.ok(r.ratio >= 4.5, `contrast ${r.ratio.toFixed(2)}`)
  assert.deepEqual(r.opaque, [], 'an opaque ancestor would hide the bands behind the text')
  const shows = await bandShows(page, 'evidence')
  assert.ok(shows.hits >= 3, `an evidence band is not visible on screen: want ${shows.want}, saw ${JSON.stringify(shows.seen)}`)
  await page.screenshot({ path: join(SHOTS, 'dark-evidence.png') })
  notes.push(`dark theme: body text ${r.text} over evidence ${r.band}, contrast ${r.ratio.toFixed(2)}; screenshots test-results/e2e/dark.png, dark-evidence.png`)
})

await scenario('a key error recovers when the key changes, without a reload', async () => {
  jev.state.mode = '401'
  const page = await context.newPage()
  await page.goto('https://arxiv.org/html/2410.00260')
  await page.waitForFunction(() => document.querySelector('jevpaper-ui')?.shadowRoot.querySelector('.fab')?.dataset.state === 'error', null, { timeout: 20_000 })
  // Spec §9: the reason is the button's accessible description
  assert.equal(await page.evaluate(() => document.querySelector('jevpaper-ui').shadowRoot.querySelector('#jp-desc').textContent), 'key 无效。点这里去更换')
  jev.state.mode = 'ok'
  jev.state.auth = []
  await seed({}, { apiKey: 'k2' })
  await hasBands(page)
  assert.ok(jev.state.auth.length > 0 && jev.state.auth.every(a => a === 'Bearer k2'), 'the run after the change uses the new key')
})

await scenario('a page without an abstract shows nothing and asks nothing', async () => {
  const asked = jev.state.requests
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  const injected = new Promise(resolve =>
    cdp.on('Runtime.executionContextCreated', e => {
      if (e.context.auxData?.type === 'isolated' && e.context.origin === `chrome-extension://${extensionId}`) resolve()
    }),
  )
  await cdp.send('Runtime.enable')
  await page.goto('https://arxiv.org/html/2608.30667')
  await injected
  // The content script gives up at its first await when there is no abstract: two frames later it is long done
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await page.locator('jevpaper-ui, jevpaper-anchors, .jevpaper-bands').count(), 0)
  assert.equal(jev.state.requests, asked)
  await cdp.detach()
})

await scenario('performance: extraction and first paint within budget on the heaviest paper', async () => {
  const page = await open('2312.17141', () => {
    window.__long = []
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) window.__long.push({ start: e.startTime, duration: e.duration })
    }).observe({ type: 'longtask', buffered: true })
  })
  const t = JSON.parse(await page.locator('jevpaper-ui').getAttribute('data-timing'))
  const long = await page.evaluate(() => window.__long)
  const longest = Math.max(0, ...long.map(e => e.duration))
  const line = `units ${t.units.toFixed(1)} ms, paint ${t.paint.toFixed(1)} ms, longest task ${longest.toFixed(1)} ms`
  console.log(`  ${line}`)
  notes.push(`performance on 2312.17141: ${line}; long tasks ${JSON.stringify(long.map(e => [Math.round(e.start), Math.round(e.duration)]))}`)
  assert.ok(t.units + t.paint <= 200, `extraction + paint ${Math.round(t.units + t.paint)} ms > 200`)
  assert.ok(longest <= 100, `a ${Math.round(longest)} ms long task`)
})

await scenario('popup: a custom endpoint is validated, saved, and the guide opens once', async () => {
  await worker.evaluate(() => chrome.storage.local.clear())
  jev.state.mode = 'ok'
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/popup.html`)
  await page.locator('input[value="custom"]').check({ force: true })
  await page.fill('#jp-endpoint', jev.url)
  await page.fill('#jp-model', 'jev')
  await page.fill('#jp-key', 'k')
  const guide = context.waitForEvent('page')
  await page.click('button[type="submit"]')
  assert.match((await guide).url(), /guide\.html$/)
  const stored = await worker.evaluate(() => chrome.storage.local.get(['settings', 'credentials']))
  assert.equal(stored.credentials.apiKey, 'k')
  assert.equal(stored.settings.guideSeen, true)
})

await scenario('popup: a refused key says how to fix it', async () => {
  await worker.evaluate(() => chrome.storage.local.clear())
  jev.state.mode = '401'
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/popup.html`)
  await page.locator('input[value="custom"]').check({ force: true })
  await page.fill('#jp-endpoint', jev.url)
  await page.fill('#jp-model', 'jev')
  await page.fill('#jp-key', 'bad')
  await page.click('button[type="submit"]')
  await page.locator('#jp-error').waitFor()
  assert.equal(await page.textContent('#jp-error'), '这把 key 无效。请检查是否完整复制，或重新生成一把')
  assert.equal(await page.getAttribute('#jp-key', 'aria-invalid'), 'true')
  assert.equal(await page.getAttribute('#jp-key', 'aria-describedby'), 'jp-error')
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'jp-key', 'focus returns to the key field')
  jev.state.mode = 'ok'
})

await context.close()
jev.close()
for (const [status, name, why, ms] of results) console.log(`${status}  ${name} (${(ms / 1000).toFixed(1)} s)${why ? `\n      ${why.split('\n').join('\n      ')}` : ''}`)
for (const note of notes) console.log(`NOTE  ${note}`)
if (blocked.size) console.log(`NOTE  blocked origins: ${[...blocked].join(', ')}`)
for (const line of logged) console.log(`LOG   ${line}`)
process.exit(results.some(r => r[0] === 'FAIL') ? 1 : 0)
