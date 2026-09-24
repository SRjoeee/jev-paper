import { afterEach, describe, expect, it, vi } from 'vitest'
import { hitTest, Interaction } from '@/content/interaction'

const range = (rects: [number, number, number, number][]) =>
  ({ getClientRects: () => rects.map(([top, bottom, left, right]) => ({ top, bottom, left, right, width: right - left, height: bottom - top })) }) as unknown as Range

describe('hitTest', () => {
  const marks = [
    { tone: 'claim' as const, ranges: [range([[100, 116, 10, 200]])] },
    { tone: 'caveat' as const, ranges: [range([[200, 216, 10, 200]])] },
    { tone: 'evidence' as const, ranges: [range([[200, 216, 10, 100]])] },
  ]
  it('prefers real containment, then a few pixels of slack', () => {
    expect(hitTest(50, 108, marks)?.index).toBe(0)
    expect(hitTest(50, 118, marks)?.index).toBe(0)
    expect(hitTest(50, 130, marks)).toBeNull()
  })
  it('where two marks overlap, the one painted on top wins', () => {
    expect(hitTest(50, 208, marks)?.index).toBe(2)
    expect(hitTest(150, 208, marks)?.index).toBe(1)
  })
})

describe('Interaction.handleClick', () => {
  // Each instance listens on the shared document: remove it, or later tests hear its handlers too
  const made: Interaction[] = []
  afterEach(() => {
    for (const i of made.splice(0)) i.destroy()
  })
  const setup = () => {
    const onActivate = vi.fn()
    const i = new Interaction({ doc: document, marks: () => [{ tone: 'claim', ranges: [range([[100, 116, 10, 200]])] }], onHover: () => {}, onScroll: () => {}, onActivate })
    made.push(i)
    return { i, onActivate }
  }
  it('a click on a mark activates it', () => {
    const { i, onActivate } = setup()
    expect(i.handleClick(50, 108, document.body, true)).toBe(true)
    expect(onActivate).toHaveBeenCalledWith(0)
  })
  it('a click that ends a selection does nothing', () => {
    const { i, onActivate } = setup()
    expect(i.handleClick(50, 108, document.body, false)).toBe(false)
    expect(onActivate).not.toHaveBeenCalled()
  })
  it('a click on a link inside a mark follows the link instead', () => {
    const { i, onActivate } = setup()
    document.body.innerHTML = '<a href="#x">[57]</a>'
    expect(i.handleClick(50, 108, document.querySelector('a'), true)).toBe(false)
    expect(onActivate).not.toHaveBeenCalled()
  })
})

// Spec §5.4 "Scrolling hides the tip" (found in the Task 14 e2e): a scroll used to reach the controller as a pointer
// leave, so the tip waited out the 220 ms leave delay after the *last* scroll event and hung over the page for a whole
// smooth jump; and a hover still waiting for its frame then re-showed the tip of the mark just clicked
describe('Interaction scrolling', () => {
  it('a scroll reports itself at once and drops a hover still waiting for its frame', () => {
    const onHover = vi.fn()
    const onScroll = vi.fn()
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 7)
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
    try {
      const i = new Interaction({ doc: document, marks: () => [{ tone: 'claim', ranges: [range([[100, 116, 10, 200]])] }], onHover, onScroll, onActivate: () => {} })
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 108 }))
      expect(raf).toHaveBeenCalledTimes(1)
      window.dispatchEvent(new Event('scroll'))
      expect(onScroll).toHaveBeenCalledTimes(1)
      expect(cancel).toHaveBeenCalledWith(7)
      expect(onHover).not.toHaveBeenCalled()
      // The next pointer move is heard again
      document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 108 }))
      expect(raf).toHaveBeenCalledTimes(2)
      i.destroy()
    } finally {
      raf.mockRestore()
      cancel.mockRestore()
    }
  })
})
