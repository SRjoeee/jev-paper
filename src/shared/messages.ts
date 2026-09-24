import type { ErrorCode } from './errors'
import type { DigestResult } from './result'
import type { ProviderId } from './settings'
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

export function isMessage(value: unknown): value is Message {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string'
}

export function send<T extends MessageType>(message: Message<T>): Promise<Reply<T>> {
  return browser.runtime.sendMessage(message) as Promise<Reply<T>>
}

export function sendToTab<T extends MessageType>(tabId: number, message: Message<T>): Promise<Reply<T>> {
  return browser.tabs.sendMessage(tabId, message) as Promise<Reply<T>>
}

export type Handlers = { [T in MessageType]?: (message: Message<T>, sender: { tabId?: number }) => Promise<Reply<T>> | undefined }

/**
 * A `runtime.onMessage` listener for a table of handlers. WXT ships no polyfill, so an asynchronous reply needs
 * `sendResponse` and `return true` (Read arXiv shared/messages.ts answerMessages, same shape).
 */
export function answer(handlers: Handlers) {
  return (message: unknown, sender: { tab?: { id?: number } }, sendResponse: (reply: unknown) => void): true | undefined => {
    if (!isMessage(message)) return undefined
    const handler = handlers[message.type] as ((m: Message, s: { tabId?: number }) => Promise<unknown> | undefined) | undefined
    if (!handler) return undefined
    let reply: Promise<unknown> | undefined
    try {
      reply = handler(message, { tabId: sender.tab?.id })
    } catch (error) {
      reply = Promise.reject(error)
    }
    if (!reply) return undefined
    reply.then(sendResponse, () => sendResponse({ ok: false, error: 'busy' }))
    return true
  }
}
