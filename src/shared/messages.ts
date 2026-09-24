import type { ErrorCode } from './errors'
import type { DigestResult } from './result'
import type { ProviderId } from './credentials'
import type { Unit } from './units'

export type DigestReply = { ok: true; result: DigestResult; cached: boolean } | { ok: false; error: ErrorCode }
export type ValidateReply = { ok: true } | { ok: false; error: ErrorCode }
export type PageStatus = { state: 'idle' } | { state: 'computing' } | { state: 'done'; marks: number } | { state: 'error'; error: ErrorCode }

export interface Messages {
  /** content → background */
  digest: { request: { paperId: string; title: string; unitsHash: string; units: Unit[] }; response: DigestReply }
  /** popup → background */
  validate: { request: { provider: ProviderId; baseUrl: string; model: string; apiKey: string }; response: ValidateReply }
  /** content → background: open the setup page in a tab (a page cannot open the popup) */
  'open-setup': { request: Record<never, never>; response: null }
  /** popup → content (tabs.sendMessage) */
  'page-status': { request: Record<never, never>; response: PageStatus }
}

export type MessageType = keyof Messages
export type Message<T extends MessageType = MessageType> = T extends unknown ? { type: T } & Messages[T]['request'] : never
export type Reply<T extends MessageType> = Messages[T]['response']

/**
 * The name of the port a paper page holds while it lives (spec §6.1): the run it waits on, so the service worker can
 * tell a reload of the same paper (which rejoins the run) from a navigation to another one (which leaves it).
 */
export const presenceName = (paperId: string, unitsHash: string): string => `page:${unitsHash}:${paperId}`

/** The run a presence port names, or null for a port that is not a paper page's */
export function presenceOf(name: string): { paperId: string; unitsHash: string } | null {
  const m = /^page:([0-9a-f]+):(.+)$/.exec(name)
  return m ? { unitsHash: m[1]!, paperId: m[2]! } : null
}

export function isMessage(value: unknown): value is Message {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
}

export function send<T extends MessageType>(message: Message<T>): Promise<Reply<T>> {
  return browser.runtime.sendMessage(message) as Promise<Reply<T>>
}

export function sendToTab<T extends MessageType>(tabId: number, message: Message<T>): Promise<Reply<T>> {
  return browser.tabs.sendMessage(tabId, message) as Promise<Reply<T>>
}

/** Who sent a message: the tab, and whether it is an incognito one */
export interface Sender {
  tabId?: number
  incognito?: boolean
}

export type Handlers = { [T in MessageType]?: (message: Message<T>, sender: Sender) => Promise<Reply<T>> | undefined }

/**
 * A `runtime.onMessage` listener for a table of handlers. WXT ships no polyfill, so an asynchronous reply needs
 * `sendResponse` and `return true` (Read arXiv shared/messages.ts answerMessages, same shape).
 */
export function answer(handlers: Handlers) {
  return (message: unknown, sender: { tab?: { id?: number; incognito?: boolean } }, sendResponse: (reply: unknown) => void): true | undefined => {
    if (!isMessage(message)) return undefined
    const handler = handlers[message.type] as ((m: Message, s: Sender) => Promise<unknown> | undefined) | undefined
    if (!handler) return undefined
    let reply: Promise<unknown> | undefined
    try {
      reply = handler(message, { tabId: sender.tab?.id, incognito: sender.tab?.incognito === true })
    } catch (error) {
      reply = Promise.reject(error)
    }
    if (!reply) return undefined
    reply.then(sendResponse, () => sendResponse({ ok: false, error: 'busy' }))
    return true
  }
}
