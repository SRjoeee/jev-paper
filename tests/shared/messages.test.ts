import { describe, expect, it } from 'vitest'
import { answer, type Sender } from '@/shared/messages'

describe('answer', () => {
  it('hands each handler the sending tab and whether it is incognito', async () => {
    const seen: Sender[] = []
    const listener = answer({
      'open-setup': async (_m, sender) => {
        seen.push(sender)
        return null
      },
    })
    const replies: unknown[] = []
    const reply = (r: unknown) => replies.push(r)
    expect(listener({ type: 'open-setup' }, { tab: { id: 3, incognito: true } }, reply)).toBe(true)
    expect(listener({ type: 'open-setup' }, { tab: { id: 4 } }, reply)).toBe(true)
    expect(listener({ type: 'open-setup' }, {}, reply)).toBe(true)
    await new Promise(r => setTimeout(r, 0))
    expect(seen).toEqual([
      { tabId: 3, incognito: true },
      { tabId: 4, incognito: false },
      { tabId: undefined, incognito: false },
    ])
    expect(replies).toEqual([null, null, null])
  })

  it('leaves other messages to other listeners', () => {
    const listener = answer({})
    expect(listener({ type: 'digest' }, {}, () => {})).toBeUndefined()
    expect(listener('not a message', {}, () => {})).toBeUndefined()
  })
})
