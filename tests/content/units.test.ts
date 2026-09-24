import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { hashUnits, isList, pageUnits, pageUnitsChunked, squash } from '@/content/units'

const load = (path: string) => new DOMParser().parseFromString(readFileSync(join(import.meta.dirname, '../fixtures', path), 'utf8'), 'text/html')

describe('pageUnits on Attention Is All You Need (1706.03762v7)', () => {
  const page = pageUnits(load('jev/1706.03762v7.html'))!

  it('finds the title and the abstract first', () => {
    expect(page.title).toBe('Attention Is All You Need')
    const abs = page.units.filter(u => u.kind === 'abstract')
    expect(abs.length).toBeGreaterThanOrEqual(5)
    expect(abs[0]!.text.startsWith('The dominant sequence transduction models')).toBe(true)
    expect(abs[0]!.sid).toBe('s001')
    expect(abs.every(u => u.sec === 'abstract' && u.secTitle === 'Abstract')).toBe(true)
  })

  it('numbers sentences in document order', () => {
    page.units.forEach((u, i) => {
      expect(u.sid).toBe(`s${String(i + 1).padStart(3, '0')}`)
    })
  })

  it('writes inline maths as short TeX and never leaks a placeholder', () => {
    expect(page.units.some(u => u.text.includes('$d_{k}$'))).toBe(true)
    expect(page.units.some(u => /<t id=|<x id=|<\/t>/.test(u.text))).toBe(false)
  })

  it('keeps sections, captions and footnotes, and drops the bibliography', () => {
    expect(page.units.some(u => u.kind === 'body' && /Introduction/.test(u.secTitle))).toBe(true)
    expect(page.units.some(u => u.kind === 'caption')).toBe(true)
    expect(page.units.some(u => /arXiv preprint/.test(u.text))).toBe(false)
  })

  it('gives every unit ranges that cover its words', () => {
    for (const u of page.units.slice(0, 60)) {
      const ranges = page.ranges.get(u.sid)!
      expect(ranges.length).toBeGreaterThan(0)
      const covered = squash(ranges.map(r => r.toString()).join(''))
      const lead = u.text.replace(/\$[^$]*\$|\[equation\]|\[math\]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 2).join(' ')
      expect(covered.replace(/\s+/g, ' ')).toContain(lead)
    }
  })
})

describe('pageUnits elsewhere', () => {
  it('flags the Kimi K3 author list, and only it, as a list', () => {
    const page = pageUnits(load('jev/2607.24653v2.html'))!
    const lists = page.units.filter(u => u.list)
    expect(lists).toHaveLength(1)
    expect(lists[0]!.secTitle).toMatch(/Contributions/)
    expect(lists[0]!.text.length).toBeGreaterThan(4000)
  })

  it('returns null for a page that is not a LaTeXML paper', () => {
    expect(pageUnits(new DOMParser().parseFromString('<html><body><p>Hello.</p></body></html>', 'text/html'))).toBeNull()
  })

  it('handles the heaviest fixture', () => {
    const page = pageUnits(load('arxiv/2312.17141.html'))!
    expect(page.units.length).toBeGreaterThan(300)
    expect(page.units.filter(u => u.list)).toHaveLength(0)
  })

  it('the chunked cut gives the same units and reports its busy time', async () => {
    const doc = load('jev/1706.03762v7.html')
    const chunked = (await pageUnitsChunked(doc, 1))!
    expect(chunked.units).toEqual(pageUnits(doc)!.units)
    expect(chunked.busyMs).toBeGreaterThan(0)
  })
})

describe('isList', () => {
  it('is true for forty-odd capitalised names and false for prose', () => {
    const names = Array.from({ length: 45 }, (_, i) => `Name${i} Surname${i}`).join(' ')
    expect(isList(names)).toBe(true)
    expect(isList('We propose a new simple network architecture, the Transformer, based solely on attention mechanisms.')).toBe(false)
  })
})

describe('hashUnits', () => {
  it('depends on kind and text only', async () => {
    const a = await hashUnits([{ sid: 's001', kind: 'abstract', sec: 'abstract', secTitle: 'Abstract', pid: 'p', text: 'One.' }])
    const b = await hashUnits([{ sid: 's009', kind: 'abstract', sec: 'x', secTitle: 'y', pid: 'q', text: 'One.' }])
    const c = await hashUnits([{ sid: 's001', kind: 'body', sec: 'abstract', secTitle: 'Abstract', pid: 'p', text: 'One.' }])
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })
})
