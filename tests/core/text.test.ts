// Copied from Read arXiv tests/core/text.test.ts@3f3c91f8 (GPL-3.0), 2026-09-24.
import { describe, expect, it } from 'vitest'
import { collectText, squash } from '@/core/text'

// One walker for the seven that were: what a caller refuses to enter is the parameter

const parse = (html: string): Element => {
  const div = document.createElement('div')
  div.innerHTML = html
  return div
}

describe('collectText', () => {
  it('collects the text nodes in document order and does not enter a subtree the barrier refuses', () => {
    const el = parse('a<b>b<i>c</i></b><span class="no">skip<em>ped</em></span>d')
    expect(collectText(el, node => node.classList.contains('no'))).toBe('abcd')
    expect(collectText(el, () => false)).toBe('abcskippedd')
    // The barrier sees every element on the way down, nested ones included
    expect(collectText(el, node => node.tagName === 'I')).toBe('abskippedd')
  })

  it('reads text nodes only — a comment is not text — and keeps whitespace as it is', () => {
    const el = parse('x <!-- not text --> <math>y</math>  z')
    expect(collectText(el, () => false)).toBe('x  y  z')
  })
})

describe('squash', () => {
  it('collapses whitespace runs to one space and trims; null and undefined are the empty string', () => {
    expect(squash('  a \t\n b  ')).toBe('a b')
    expect(squash(null)).toBe('')
    expect(squash(undefined)).toBe('')
  })
})
