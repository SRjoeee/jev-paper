import { describe, expect, it } from 'vitest'
import { applyTheme } from '@/shared/theme'

/** A minimal, controllable stand-in for `MediaQueryList`: one listener, a mutable `matches` */
function fakeMql(initial: boolean) {
  let listener: (() => void) | null = null
  return {
    mql: {
      get matches() {
        return initial
      },
      addEventListener: (_type: string, cb: () => void) => {
        listener = cb
      },
      removeEventListener: (_type: string, cb: () => void) => {
        if (listener === cb) listener = null
      },
    } as unknown as MediaQueryList,
    set(matches: boolean) {
      initial = matches
      listener?.()
    },
  }
}

describe('applyTheme', () => {
  it('sets data-theme from the OS preference at once', () => {
    const root = document.createElement('div')
    const { mql } = fakeMql(false)
    applyTheme(root, mql)
    expect(root.dataset.theme).toBe('light')
  })

  it('follows a live change to the OS theme', () => {
    const root = document.createElement('div')
    const { mql, set } = fakeMql(false)
    applyTheme(root, mql)
    expect(root.dataset.theme).toBe('light')
    set(true)
    expect(root.dataset.theme).toBe('dark')
    set(false)
    expect(root.dataset.theme).toBe('light')
  })

  it('stops listening once the returned cleanup runs', () => {
    const root = document.createElement('div')
    const { mql, set } = fakeMql(false)
    const stop = applyTheme(root, mql)
    stop()
    set(true)
    expect(root.dataset.theme).toBe('light')
  })
})
