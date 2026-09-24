import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { createController } from '@/content/controller'
import { PageUi } from '@/content/ui/page-ui'
import type { PageUnits } from '@/content/units'
import { Guide } from '@/entrypoints/guide/Guide'
import { App } from '@/entrypoints/popup/App'
import { COPY, LANG } from '@/shared/copy'
import { saveCredentials } from '@/shared/credentials'
import { DEFAULT_SETTINGS, patchSettings, type Settings } from '@/shared/settings'

// Chrome in English: set before this file's imports evaluate copy.ts (tests/setup.ts pins Chinese for the others)
await vi.hoisted(async () => {
  const { fakeBrowser } = await import('wxt/testing/fake-browser')
  fakeBrowser.i18n.getUILanguage = () => 'en-US'
})

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const frame = () => new Promise(r => requestAnimationFrame(() => r(null)))

it('follows Chrome UI language en-US to English', () => {
  expect(LANG).toBe('en')
  expect(COPY.button).toBe('JevPaper: choose what to mark')
})

describe('the page UI in English', () => {
  function setup() {
    document.body.innerHTML = ''
    const events = { level: vi.fn(), action: vi.fn(), tip: vi.fn(), anchor: vi.fn(), anchorFocus: vi.fn() }
    const ui = new PageUi(document, events)
    const host = document.querySelector('jevpaper-ui')!
    const $ = <T extends Element = HTMLElement>(s: string) => host.shadowRoot!.querySelector(s) as T
    const $$ = (s: string) => [...host.shadowRoot!.querySelectorAll<HTMLElement>(s)]
    return { ui, host, $, $$ }
  }

  it('names the button and the menu, and the menu rows are the three layers', () => {
    const { host, $, $$ } = setup()
    expect($('.fab').getAttribute('aria-label')).toBe('JevPaper: choose what to mark')
    expect($('#jp-menu').getAttribute('aria-label')).toBe('What to mark')
    expect($$('.row').map(r => r.textContent)).toEqual(['Claims & evidence', 'Assumptions & limits', 'More candidates'])
    // Screen readers and font fallback follow the interface, not the paper
    expect(host.getAttribute('lang')).toBe('en')
    expect(document.querySelector('jevpaper-anchors')!.getAttribute('lang')).toBe('en')
  })

  it('an error says how to fix it, as the description and on hover', () => {
    const { ui, $ } = setup()
    ui.setState({ kind: 'error', error: 'offline' })
    expect($('#jp-desc').textContent).toBe('Can’t reach the service. Check your network, then click here to try again.')
    ui.setState({ kind: 'attention', error: 'no-key' })
    $('.fab').dispatchEvent(new MouseEvent('mouseenter'))
    expect($('.tip').textContent).toBe('No API key yet. Click here to add one.')
  })

  it('the first-run bubble points at the button', () => {
    const { ui, $ } = setup()
    ui.showBubble(() => {})
    expect($('.bubble').textContent).toBe('Click here to choose what to mark')
  })
})

describe('the page, marked, in English', () => {
  const r = () => ({ getClientRects: () => [], getBoundingClientRect: () => ({ top: 0 }) }) as unknown as Range
  const page: PageUnits = {
    title: 'T',
    units: [
      { sid: 's001', kind: 'abstract', sec: 'abstract', secTitle: 'Abstract', pid: 'a', text: 'We propose X.' },
      { sid: 's002', kind: 'abstract', sec: 'abstract', secTitle: 'Abstract', pid: 'a', text: 'X is fast.' },
      { sid: 's003', kind: 'body', sec: 'S1', secTitle: '1 Method', pid: 'p', text: 'X works by Y.' },
      { sid: 's004', kind: 'body', sec: 'S2', secTitle: '2 Limits', pid: 'q', text: 'X fails on Z.' },
    ],
    ranges: new Map(['s001', 's002', 's003', 's004'].map(sid => [sid, [r()]])),
  }
  const result = {
    claims: [
      { sid: 's001', pClaim: 0.9, role: 'method' as const, ranked: [['s003', 0.8]] as [string, number][] },
      { sid: 's002', pClaim: 0.9, role: null, ranked: [['s003', 0.7]] as [string, number][] },
    ],
    caveats: [['s004', 0.9, 'limitation']] as [string, number, 'limitation'][],
  }

  async function marked() {
    document.body.innerHTML = ''
    let settings: Settings = { ...DEFAULT_SETTINGS, level: 2, bubbleSeen: true }
    const layer = {
      theme: 'light' as const,
      paint: vi.fn(),
      bandsOf: vi.fn(() => [{ mark: 0, tone: 'claim' as const, left: 1, top: 2, width: 3, height: 4, radius: [4, 4, 4, 4] as [number, number, number, number] }]),
      setHot: vi.fn(),
      pulse: vi.fn(),
      destroy: vi.fn(),
    }
    const c = createController({
      page,
      paperId: '1706.03762',
      unitsHash: 'h',
      digest: async () => ({ ok: true, result, cached: false }),
      openSetup: vi.fn(),
      layer,
      makeUi: events => new PageUi(document, events),
      settings: {
        get: async () => settings,
        watch: () => () => {},
        patch: async p => {
          settings = { ...settings, ...p }
        },
      },
      scrollTo: (_ranges, then) => then(),
    })
    await c.start()
    await frame()
    const root = document.querySelector('jevpaper-ui')!.shadowRoot!
    const tip = () => root.querySelector('.tip')?.textContent
    const hover = (index: number) => {
      c.hover(null, 0)
      c.hover({ index, rect: { top: 100, bottom: 120 } as DOMRect }, 50)
    }
    return { c, root, tip, hover }
  }

  it('announces the marks, and the tips name each one', async () => {
    const { c, root, tip, hover } = await marked()
    expect(root.querySelector('[role="status"]')!.textContent).toBe(`${c.paintedMarks().length} marks on this page`)
    // Marks in order: claims 1 and 2, their shared evidence, the caveat
    hover(0)
    expect(tip()).toBe('Claim 1 · Method · Click to see its evidence')
    hover(1)
    expect(tip()).toBe('Claim 2 · Click to see its evidence')
    hover(2)
    expect(tip()).toBe('Delivers claims 1, 2 · Click to go back')
    hover(3)
    expect(tip()).toBe('Limitation')
  })

  it('names the keyboard anchors', async () => {
    await marked()
    const anchors = document.querySelector('jevpaper-anchors')!.shadowRoot!
    expect([...anchors.querySelectorAll('button')].map(b => b.getAttribute('aria-label'))).toEqual(['Claim 1: jump to its evidence', 'Claim 2: jump to its evidence', 'Evidence: go back to claim 1'])
  })
})

describe('the popup in English', () => {
  async function render() {
    document.body.innerHTML = ''
    const el = document.createElement('div')
    document.body.append(el)
    await act(async () => createRoot(el).render(<App />))
    await act(async () => {})
    return el
  }
  const q = <T extends Element = HTMLElement>(el: Element, s: string) => el.querySelector(s) as T

  beforeEach(() => {
    fakeBrowser.reset()
    vi.restoreAllMocks()
  })

  it('first open: the lede, the services, a labelled key field, where to get a key, and the button', async () => {
    const el = await render()
    expect(q(el, '.lede').textContent).toBe('Open an arXiv paper and its key sentences are marked for you.')
    expect([...el.querySelectorAll('.seg-item')].map(n => n.textContent)).toEqual(['OpenRouter', 'TypeSafe', 'Custom'])
    expect(q(el, 'legend').textContent).toBe('Service')
    expect(q(el, 'label[for="jp-key"]').textContent).toBe('API key')
    expect(q(el, '.hint a').textContent).toBe('Get a key from OpenRouter ↗')
    expect(q(el, '.hint').textContent).toContain('Stays on this device')
    expect(q(el, 'button[type="submit"]').textContent).toBe('Get started')
  })

  it('an error says how to fix it', async () => {
    vi.spyOn(browser.runtime, 'sendMessage').mockImplementation(async () => ({ ok: false, error: 'invalid-key' }))
    const el = await render()
    await act(async () => q<HTMLFormElement>(el, 'form').requestSubmit())
    expect(q(el, '#jp-error').textContent).toBe('Paste your API key.')
    const key = q<HTMLInputElement>(el, '#jp-key')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(key, 'sk-or-bad')
      key.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => q<HTMLFormElement>(el, 'form').requestSubmit())
    await act(async () => {})
    expect(q(el, '#jp-error').textContent).toBe('This key is invalid. Check that you copied all of it, or create a new one.')
  })

  it('a custom endpoint: labelled fields, and the endpoint error', async () => {
    const el = await render()
    await act(async () => q<HTMLInputElement>(el, 'input[value="custom"]').click())
    expect(q(el, 'label[for="jp-endpoint"]').textContent).toBe('Endpoint')
    expect(q(el, 'label[for="jp-model"]').textContent).toBe('Model')
    expect(q<HTMLInputElement>(el, '#jp-model').placeholder).toBe('jev-latest')
    await act(async () => q<HTMLFormElement>(el, 'form').requestSubmit())
    expect(q(el, '#jp-error').textContent).toBe('Enter an endpoint starting with https:// (http:// for localhost) and a model name.')
  })

  it('with a key: the layer rows, the page status, and the account and guide buttons', async () => {
    await saveCredentials({ provider: 'openrouter', baseUrl: '', model: '', apiKey: 'sk-or-v1-abcdef0123456789' })
    await patchSettings({ level: 1 })
    vi.spyOn(browser.tabs, 'query').mockImplementation(async () => [{ id: 7 } as never])
    vi.spyOn(browser.tabs, 'sendMessage').mockImplementation(async () => ({ state: 'done', marks: 24 }))
    const el = await render()
    expect(q(el, '.layers').getAttribute('aria-label')).toBe('What to mark')
    expect([...el.querySelectorAll('.row')].map(r => r.textContent)).toEqual(['Claims & evidence', 'Assumptions & limits', 'More candidates'])
    expect(q(el, '.status').textContent).toBe('24 marks on this page')
    expect([...el.querySelectorAll('button.link')].map(b => b.textContent)).toEqual(['Change', 'Show guide'])
  })

  it('off a paper page, and on a page that failed, the status says what to do, never to click', async () => {
    await saveCredentials({ provider: 'openrouter', baseUrl: '', model: '', apiKey: 'k-long-enough-key' })
    vi.spyOn(browser.tabs, 'query').mockImplementation(async () => [{ id: 7 } as never])
    const send = vi.spyOn(browser.tabs, 'sendMessage').mockRejectedValue(new Error('no receiver'))
    expect(q(await render(), '.status').textContent).toBe('Open any arXiv paper’s HTML page to start.')
    send.mockImplementation(async () => ({ state: 'error', error: 'busy' }))
    expect(q(await render(), '.status').textContent).toBe('The service is busy. Try again soon.')
    send.mockImplementation(async () => ({ state: 'error', error: 'invalid-key' }))
    expect(q(await render(), '.status').textContent).toBe('This key is invalid. Change it below.')
    send.mockImplementation(async () => ({ state: 'done', marks: 0 }))
    expect(q(await render(), '.status').textContent).toBe('Nothing to mark in this paper')
  })
})

describe('the guide in English', () => {
  it('names itself, explains the three colours and how to use it, and links the trial paper', async () => {
    document.body.innerHTML = ''
    const el = document.createElement('div')
    document.body.append(el)
    await act(async () => createRoot(el).render(<Guide />))
    expect(el.querySelector('h1')!.textContent).toBe('JevPaper is ready')
    expect(el.querySelector('.lede')!.textContent).toBe('Open any arXiv paper’s HTML page, and JevPaper marks its key sentences right in the text.')
    expect([...el.querySelectorAll('h2')].map(n => n.textContent)).toEqual(['Three colours', 'How to use it'])
    expect([...el.querySelectorAll('.legend strong')].map(n => n.textContent)).toEqual(['Claims & evidence', 'Assumptions & limits', 'More candidates'])
    expect([...el.querySelectorAll('.legend .note')].map(n => n.textContent)).toEqual([
      'A claim in the abstract, and the sentence in the body that delivers it',
      'Assumptions and limits you need to know',
      'Other sentences that may deliver a claim',
    ])
    expect([...el.querySelectorAll('.tips li')].map(n => n.textContent)).toEqual([
      'Click a claim in the abstract to jump to the sentence that delivers it. Click that sentence to go back.',
      'Click the button at the bottom right to choose what to mark.',
    ])
    const cta = el.querySelector<HTMLAnchorElement>('a.primary')!
    expect(cta.textContent).toBe('Try it: Attention Is All You Need')
    expect(cta.getAttribute('href')).toBe('https://arxiv.org/html/1706.03762')
  })
})
