import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PageUi } from '@/content/ui/page-ui'

function setup() {
  document.body.innerHTML = ''
  const events = { level: vi.fn(), action: vi.fn(), tip: vi.fn(), anchor: vi.fn(), anchorFocus: vi.fn() }
  const ui = new PageUi(document, events)
  const root = document.querySelector('jevpaper-ui')!.shadowRoot!
  const $ = <T extends Element = HTMLElement>(s: string) => root.querySelector(s) as T
  const $$ = (s: string) => [...root.querySelectorAll<HTMLElement>(s)]
  return { ui, events, root, $, $$ }
}
const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, composed: true }))

describe('PageUi', () => {
  beforeEach(() => { document.body.innerHTML = '' })

  it('the button is a named menu button that starts closed', () => {
    const { $ } = setup()
    const fab = $<HTMLButtonElement>('.fab')
    expect(fab.tagName).toBe('BUTTON')
    expect(fab.getAttribute('aria-label')).toBe('JevPaper：选择标记多少')
    expect(fab.getAttribute('aria-expanded')).toBe('false')
    expect(fab.getAttribute('aria-controls')).toBe('jp-menu')
  })

  it('rows are a radio group with the current level checked, lit up to it, and one tab stop', () => {
    const { ui, $, $$ } = setup()
    ui.setLevel(2)
    expect($('#jp-menu').getAttribute('role')).toBe('radiogroup')
    const rows = $$('.row')
    expect(rows.map(r => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
    expect(rows.map(r => r.tabIndex)).toEqual([-1, 0, -1])
    expect(rows.map(r => r.hasAttribute('data-lit'))).toEqual([true, true, false])
    expect(rows.map(r => r.textContent)).toEqual(['主张与证据', '假设与局限', '更多候选'])
  })

  it('opening focuses the checked row; a click on a row applies it and keeps the menu open', () => {
    const { ui, events, root, $, $$ } = setup()
    ui.setLevel(1)
    $('.fab').click()
    expect($('.fab').getAttribute('aria-expanded')).toBe('true')
    expect($('#jp-menu').hasAttribute('data-open')).toBe(true)
    expect(root.activeElement).toBe($$('.row')[0])
    $$('.row')[2]!.click()
    expect(events.level).toHaveBeenCalledWith(3)
    expect($('#jp-menu').hasAttribute('data-open')).toBe(true)
  })

  it('arrow keys move the selection and apply it at once, wrapping', () => {
    const { ui, events, $, $$ } = setup()
    ui.setLevel(3)
    $('.fab').click()
    key($$('.row')[2]!, 'ArrowDown')
    expect(events.level).toHaveBeenLastCalledWith(1)
    ui.setLevel(1)
    key($$('.row')[0]!, 'ArrowUp')
    expect(events.level).toHaveBeenLastCalledWith(3)
  })

  it('Escape closes the menu and returns focus to the button', () => {
    const { root, $, $$ } = setup()
    $('.fab').click()
    key($$('.row')[0]!, 'Escape')
    expect($('#jp-menu').hasAttribute('data-open')).toBe(false)
    expect($('.fab').getAttribute('aria-expanded')).toBe('false')
    expect(root.activeElement).toBe($('.fab'))
  })

  it('in an error or key state the button acts instead of opening the menu, and says why', () => {
    const { ui, events, $ } = setup()
    ui.setState({ kind: 'error', error: 'busy' })
    $('.fab').click()
    expect(events.action).toHaveBeenCalledTimes(1)
    expect($('#jp-menu').hasAttribute('data-open')).toBe(false)
    expect($('#jp-desc').textContent).toBe('服务繁忙。点这里重试')
    expect($('.fab').dataset.state).toBe('error')
  })

  it('in a key or error state, hovering the button shows the reason; leaving hides it', () => {
    const { ui, $ } = setup()
    ui.setState({ kind: 'attention', error: 'no-key' })
    $('.fab').dispatchEvent(new MouseEvent('mouseenter'))
    expect($('.tip').textContent).toBe('还没有设置 key。点这里去设置')
    $('.fab').dispatchEvent(new MouseEvent('mouseleave'))
    expect($('.tip')).toBeNull()
    ui.setState({ kind: 'done' })
    $('.fab').dispatchEvent(new MouseEvent('mouseenter'))
    expect($('.tip')).toBeNull()
  })

  it('shows a ring while computing and a dot when a key is needed', () => {
    const { ui, $ } = setup()
    ui.setState({ kind: 'computing' })
    expect($('.ring').hidden).toBe(false)
    ui.setState({ kind: 'attention', error: 'no-key' })
    expect($('.ring').hidden).toBe(true)
    expect($('.dot').hidden).toBe(false)
  })

  it('announces through a stable, initially empty status region', async () => {
    const { ui, $ } = setup()
    const status = $('[role="status"]')
    expect(status.textContent).toBe('')
    ui.announce('已标出 12 处')
    await new Promise(r => requestAnimationFrame(() => r(null)))
    expect(status.textContent).toBe('已标出 12 处')
  })

  it('keyboard anchors are named buttons that act on Enter and report focus', () => {
    const { ui, events } = setup()
    ui.setAnchors([{ index: 4, label: '摘要第 1 条：跳到正文证据', left: 10, top: 20, width: 100, height: 24 }])
    const anchors = document.querySelector('jevpaper-anchors')!.shadowRoot!
    const button = anchors.querySelector('button')!
    expect(button.getAttribute('aria-label')).toBe('摘要第 1 条：跳到正文证据')
    button.focus()
    expect(events.anchorFocus).toHaveBeenCalledWith(4)
    button.click()
    expect(events.anchor).toHaveBeenCalledWith(4)
  })

  it('a link tip is a button that reports a click; a caveat tip is not', () => {
    const { ui, events, $ } = setup()
    ui.showTip('兑现摘要第 2 条 · 点击回到摘要', { x: 100, top: 300, bottom: 320 }, true)
    $('.tip').click()
    expect(events.tip).toHaveBeenCalled()
    ui.showTip('局限', { x: 100, top: 300, bottom: 320 }, false)
    expect($('.tip').tagName).toBe('DIV')
    expect($('.tip').getAttribute('role')).toBe('tooltip')
    ui.hideTip()
    expect($('.tip')).toBeNull()
  })

  it('removes both hosts on destroy', () => {
    const { ui } = setup()
    ui.destroy()
    expect(document.querySelector('jevpaper-ui, jevpaper-anchors')).toBeNull()
  })

  it('setTheme switches data-theme on the element carrying .jp-theme, and back', () => {
    const { ui, root } = setup()
    const themed = root.querySelector('.jp-theme')!
    expect(themed.getAttribute('data-theme')).toBe('light')
    ui.setTheme('dark')
    expect(themed.getAttribute('data-theme')).toBe('dark')
    ui.setTheme('light')
    expect(themed.getAttribute('data-theme')).toBe('light')
  })

  it('showBubble shows the bubble; dismissing it hides the bubble and calls onDismiss once', () => {
    const { ui, $ } = setup()
    const onDismiss = vi.fn()
    ui.showBubble(onDismiss)
    const bubble = $('.bubble')
    expect(bubble.hidden).toBe(false)
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(bubble.hidden).toBe(true)
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
