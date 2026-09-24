import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import { Guide } from '@/entrypoints/guide/Guide'
import { HIGHLIGHTER_PATHS } from '@/shared/icon'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('guide', () => {
  it('names itself, explains the three colours and links the trial paper', async () => {
    const el = document.createElement('div')
    document.body.append(el)
    await act(async () => createRoot(el).render(<Guide />))
    expect(el.querySelector('h1')!.textContent).toBe('JevPaper 已就绪')
    expect([...el.querySelectorAll('.legend strong')].map(n => n.textContent)).toEqual(['主张与证据', '假设与局限', '更多候选'])
    const cta = el.querySelector<HTMLAnchorElement>('a.primary')!
    expect(cta.textContent).toBe('试一试：Attention Is All You Need')
    expect(cta.getAttribute('href')).toBe('https://arxiv.org/html/1706.03762')
    expect(cta.hasAttribute('target')).toBe(false)
  })
})

describe('scripts/icons.mjs', () => {
  it('keeps the toolbar glyph in sync with the in-page highlighter icon', () => {
    const script = readFileSync(join(import.meta.dirname, '../../scripts/icons.mjs'), 'utf8')
    expect(script).toContain(HIGHLIGHTER_PATHS)
  })
})
