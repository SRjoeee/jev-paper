import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { App } from '@/entrypoints/popup/App'
import { getCredentials, saveCredentials } from '@/shared/credentials'
import { getSettings, patchSettings } from '@/shared/settings'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

async function render() {
  document.body.innerHTML = ''
  const el = document.createElement('div')
  document.body.append(el)
  await act(async () => createRoot(el).render(<App />))
  await act(async () => {})
  return el
}
const q = <T extends Element = HTMLElement>(el: Element, s: string) => el.querySelector(s) as T
function type(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
async function submit(el: Element) {
  await act(async () => q<HTMLFormElement>(el, 'form').requestSubmit())
  await act(async () => {})
}

describe('popup', () => {
  beforeEach(() => {
    fakeBrowser.reset()
    vi.restoreAllMocks()
  })

  it('first open asks for a key, with a visible label and a link that names where to get one', async () => {
    const el = await render()
    expect(q(el, 'label[for="jp-key"]').textContent).toBe('API key')
    expect(q<HTMLInputElement>(el, '#jp-key').type).toBe('password')
    expect(q(el, '.hint a').textContent).toBe('在 OpenRouter 获取 key ↗')
    expect(q(el, 'button[type="submit"]').textContent).toBe('开始使用')
  })

  it('an empty key says how to fix it next to the field and focuses it', async () => {
    const el = await render()
    await submit(el)
    const key = q<HTMLInputElement>(el, '#jp-key')
    expect(q(el, '#jp-error').textContent).toBe('请粘贴 API key')
    expect(key.getAttribute('aria-invalid')).toBe('true')
    expect(key.getAttribute('aria-describedby')).toBe('jp-error')
    expect(document.activeElement).toBe(key)
  })

  it('a valid key is saved and the guide opens once', async () => {
    const sendMessage = vi.spyOn(browser.runtime, 'sendMessage').mockImplementation(async () => ({ ok: true }))
    const create = vi.spyOn(browser.tabs, 'create').mockResolvedValue({} as never)
    const el = await render()
    await act(async () => type(q(el, '#jp-key'), ' sk-or-good '))
    await submit(el)
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'validate', provider: 'openrouter', apiKey: 'sk-or-good' }))
    expect((await getCredentials()).apiKey).toBe('sk-or-good')
    const s = await getSettings()
    expect(s.guideSeen).toBe(true)
    expect(s.keyStamp).toBe(1)
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('a key the service refuses shows the matching fix and saves nothing', async () => {
    vi.spyOn(browser.runtime, 'sendMessage').mockImplementation(async () => ({ ok: false, error: 'credit' }))
    const el = await render()
    await act(async () => type(q(el, '#jp-key'), 'sk-or-empty'))
    await submit(el)
    expect(q(el, '#jp-error').textContent).toBe('这把 key 的额度用完了。请充值，或换一把 key')
    expect((await getCredentials()).apiKey).toBe('')
  })

  it('a custom endpoint needs an https or local address and a model', async () => {
    const el = await render()
    await act(async () => q<HTMLInputElement>(el, 'input[value="custom"]').click())
    await act(async () => type(q(el, '#jp-endpoint'), 'http://example.com/v1/systemone'))
    await act(async () => type(q(el, '#jp-key'), 'k'))
    await submit(el)
    expect(q(el, '#jp-error').textContent).toBe('请填写以 https:// 开头的地址（本机地址可用 http://）和模型名')
    expect(q(el, '#jp-endpoint').getAttribute('aria-invalid')).toBe('true')
  })

  it('with a key: the layer rows, the page status and the masked key; a row applies its level', async () => {
    await saveCredentials({ provider: 'openrouter', baseUrl: '', model: '', apiKey: 'sk-or-v1-abcdef0123456789' })
    await patchSettings({ level: 1 })
    vi.spyOn(browser.tabs, 'query').mockImplementation(async () => [{ id: 7 } as never])
    vi.spyOn(browser.tabs, 'sendMessage').mockImplementation(async () => ({ state: 'done', marks: 24 }))
    const el = await render()
    const rows = [...el.querySelectorAll<HTMLElement>('.row')]
    expect(rows.map(r => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
    expect(q(el, '.status').textContent).toBe('已标出 24 处')
    expect(q(el, '.account').textContent).toContain('sk-or-…6789')
    await act(async () => rows[2]!.click())
    expect((await getSettings()).level).toBe(3)
  })

  it('off a paper page the status says where it works', async () => {
    await saveCredentials({ provider: 'openrouter', baseUrl: '', model: '', apiKey: 'k-long-enough-key' })
    vi.spyOn(browser.tabs, 'query').mockImplementation(async () => [{ id: 7 } as never])
    vi.spyOn(browser.tabs, 'sendMessage').mockRejectedValue(new Error('no receiver'))
    const el = await render()
    expect(q(el, '.status').textContent).toBe('打开任意 arXiv 论文的 HTML 版即可使用')
  })
})
