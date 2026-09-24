import { afterEach, describe, expect, it } from 'vitest'
import { themeOf } from '@/content/bands/theme'

describe('themeOf', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.style.backgroundColor = ''
    document.body.style.backgroundColor = ''
  })

  it('reads data-theme when present, even over a painted background', () => {
    document.documentElement.setAttribute('data-theme', 'dark')
    document.body.style.backgroundColor = 'rgb(255, 255, 255)'
    expect(themeOf(document)).toBe('dark')
  })

  it('falls back to the first painted background: a transparent body defers to <html>', () => {
    document.body.style.backgroundColor = 'transparent'
    document.documentElement.style.backgroundColor = 'rgb(10, 10, 10)'
    expect(themeOf(document)).toBe('dark')
  })

  it('prefers the body over <html> when both paint', () => {
    document.body.style.backgroundColor = 'rgb(10, 10, 10)'
    document.documentElement.style.backgroundColor = 'rgb(255, 255, 255)'
    expect(themeOf(document)).toBe('dark')
  })

  it('is light when neither body nor html paints a background', () => {
    document.body.style.backgroundColor = 'transparent'
    document.documentElement.style.backgroundColor = 'transparent'
    expect(themeOf(document)).toBe('light')
  })
})
