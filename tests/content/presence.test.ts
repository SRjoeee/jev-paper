import { describe, expect, it } from 'vitest'
import { type PagePort, pagePresence } from '@/content/presence'

function fakeConnect() {
  const opened: { name: string; closed: boolean; drop: () => void }[] = []
  const connect = (name: string): PagePort => {
    const listeners: (() => void)[] = []
    const drop = () => {
      for (const cb of listeners) cb()
    }
    const entry = { name, closed: false, drop }
    opened.push(entry)
    return {
      onDisconnect: { addListener: cb => listeners.push(cb) },
      disconnect: () => {
        entry.closed = true
      },
    }
  }
  return { opened, connect }
}

describe('pagePresence', () => {
  it('opens one port for as long as it stays open', () => {
    const f = fakeConnect()
    const p = pagePresence('page:ab:1706.03762', f.connect)
    p.hold()
    p.hold()
    expect(f.opened.map(o => o.name)).toEqual(['page:ab:1706.03762'])
  })

  it('opens a new port on the next hold once Chrome closed the old one (the service worker stopped)', () => {
    const f = fakeConnect()
    const p = pagePresence('page:ab:x', f.connect)
    p.hold()
    f.opened[0]!.drop()
    p.hold()
    expect(f.opened).toHaveLength(2)
  })

  it('release closes the port, and the next hold opens another', () => {
    const f = fakeConnect()
    const p = pagePresence('page:ab:x', f.connect)
    p.hold()
    p.release()
    expect(f.opened[0]!.closed).toBe(true)
    p.hold()
    expect(f.opened).toHaveLength(2)
  })

  it('survives a connect that throws (extension context invalidated)', () => {
    const p = pagePresence('page:ab:x', () => {
      throw new Error('Extension context invalidated.')
    })
    expect(() => p.hold()).not.toThrow()
    expect(() => p.release()).not.toThrow()
  })
})
