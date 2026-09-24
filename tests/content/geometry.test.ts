import { describe, expect, it } from 'vitest'
import { layoutBands, linesOf } from '@/content/bands/geometry'

const box = (top: number, bottom: number, left: number, right: number) => ({ top, bottom, left, right })
const origin = { left: 0, top: 0 }

describe('linesOf', () => {
  it('merges rectangles of one line and drops a display-equation box', () => {
    const { lines, glyph } = linesOf([box(100, 116, 10, 60), box(98, 118, 60, 90), box(120, 200, 10, 400), box(124, 140, 10, 300)])
    // heights 16, 16, 20, 80 → the upper median, 20; the 80 px box is over 2.2 × 20 and dropped
    expect(glyph).toBe(20)
    expect(lines).toEqual([box(98, 118, 10, 90), box(124, 140, 10, 300)])
  })
})

describe('layoutBands', () => {
  it('a one-line mark is one line-height tall, centred on its line, 2 px wider each side, all corners round', () => {
    const [b] = layoutBands([{ mark: 0, tone: 'evidence', lines: [box(100, 116, 10, 60)], glyph: 16, lineHeight: 24 }], origin, 1)
    expect(b).toEqual({ mark: 0, tone: 'evidence', left: 8, top: 96, width: 54, height: 24, radius: [4, 4, 4, 4] })
  })

  it('consecutive lines of a mark meet at the midpoint, the upper reaching half a pixel into the lower', () => {
    const bands = layoutBands([{ mark: 0, tone: 'claim', lines: [box(100, 116, 10, 300), box(124, 140, 10, 120)], glyph: 16, lineHeight: 24 }], origin, 2)
    expect(bands[0]!.top + bands[0]!.height).toBe(120.5)
    expect(bands[1]!.top).toBe(120)
    expect(bands[0]!.radius).toEqual([4, 4, 0, 0])
    expect(bands[1]!.radius).toEqual([0, 0, 4, 4])
  })

  it('leaves the display equation a sentence runs on through unpainted: lines apart by more than a line height do not meet', () => {
    // Two lines of the paragraph before the equation, then the first line of the one after it, 60 px below
    const bands = layoutBands(
      [{ mark: 0, tone: 'evidence', lines: [box(100, 116, 10, 300), box(124, 140, 10, 120), box(200, 216, 10, 250)], glyph: 16, lineHeight: 24 }],
      origin,
      1,
    )
    expect(bands.map(b => [b.top, b.top + b.height])).toEqual([
      [96, 121],
      [120, 144],
      [196, 220],
    ])
    expect(bands.map(b => b.radius)).toEqual([
      [4, 4, 0, 0],
      [0, 0, 4, 4],
      [4, 4, 4, 4],
    ])
  })

  it('joins two same-tone marks on one line at the midpoint of their gap, with square corners at the join', () => {
    const bands = layoutBands(
      [
        { mark: 0, tone: 'claim', lines: [box(100, 116, 10, 100)], glyph: 16, lineHeight: 24 },
        { mark: 1, tone: 'claim', lines: [box(100, 116, 106, 200)], glyph: 16, lineHeight: 24 },
      ],
      origin,
      1,
    )
    const [a, b] = bands
    expect(a!.left + a!.width).toBe(b!.left)
    expect(a!.radius).toEqual([4, 0, 0, 4])
    expect(b!.radius).toEqual([0, 4, 4, 0])
  })

  it('does not join different tones', () => {
    const [a, b] = layoutBands(
      [
        { mark: 0, tone: 'claim', lines: [box(100, 116, 10, 100)], glyph: 16, lineHeight: 24 },
        { mark: 1, tone: 'caveat', lines: [box(100, 116, 106, 200)], glyph: 16, lineHeight: 24 },
      ],
      origin,
      1,
    )
    expect(a!.left + a!.width).toBe(102)
    expect(b!.left).toBe(104)
  })

  it('rounds to device pixels and subtracts the layer origin', () => {
    const [b] = layoutBands([{ mark: 0, tone: 'evidence', lines: [box(100.3, 116.3, 10.3, 60.3)], glyph: 16, lineHeight: null }], { left: 5, top: 50 }, 2)
    for (const v of [b!.left, b!.top, b!.width, b!.height]) expect(v * 2).toBe(Math.round(v * 2))
    expect(b!.left).toBe(3.5)
  })

  it('joins same-tone marks with tall lineHeight whose centres are within the tolerance', () => {
    const bands = layoutBands(
      [
        { mark: 0, tone: 'claim', lines: [box(100, 116, 10, 100)], glyph: 16, lineHeight: 60 },
        { mark: 1, tone: 'claim', lines: [box(110, 126, 106, 200)], glyph: 16, lineHeight: 60 },
      ],
      origin,
      1,
    )
    const [a, b] = bands
    expect(a!.left + a!.width).toBe(b!.left)
    expect(a!.radius).toEqual([4, 0, 0, 4])
    expect(b!.radius).toEqual([0, 4, 4, 0])
    expect(a!.top).toBe(b!.top)
    expect(a!.height).toBe(b!.height)
  })

  it('does not join same-tone marks with short lineHeight when centres exceed the tolerance', () => {
    const bands = layoutBands(
      [
        { mark: 0, tone: 'claim', lines: [box(100, 116, 10, 100)], glyph: 16, lineHeight: 16 },
        { mark: 1, tone: 'claim', lines: [box(110, 126, 106, 200)], glyph: 16, lineHeight: 16 },
      ],
      origin,
      1,
    )
    const [a, b] = bands
    expect(a!.left + a!.width).toBe(102)
    expect(b!.left).toBe(104)
  })

  it('joins same-tone marks on one line whose padded edges overlap', () => {
    const bands = layoutBands(
      [
        { mark: 0, tone: 'claim', lines: [box(100, 116, 10, 100)], glyph: 16, lineHeight: 24 },
        { mark: 1, tone: 'claim', lines: [box(100, 116, 99, 200)], glyph: 16, lineHeight: 24 },
      ],
      origin,
      1,
    )
    const [a, b] = bands
    expect(a!.left + a!.width).toBe(b!.left)
    expect(a!.radius).toEqual([4, 0, 0, 4])
    expect(b!.radius).toEqual([0, 4, 4, 0])
  })
})
