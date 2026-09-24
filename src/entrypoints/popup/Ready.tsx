import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import type { Credentials } from '@/shared/credentials'
import { COPY } from '@/shared/copy'
import { LAYERS, type Level } from '@/shared/levels'
import { type PageStatus, sendToTab } from '@/shared/messages'
import { patchSettings, type Settings } from '@/shared/settings'
import { Brand } from './Brand'

async function pageStatus(): Promise<PageStatus | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (tab?.id === undefined) return null
  try {
    return await sendToTab(tab.id, { type: 'page-status' })
  } catch {
    return null
  }
}

function statusLine(status: PageStatus | null): string {
  if (!status || status.state === 'idle') return COPY.status.notPaper
  if (status.state === 'computing') return COPY.status.computing
  if (status.state === 'error') return COPY.pageError[status.error]
  return status.marks ? COPY.status.marked(status.marks) : COPY.status.none
}

const mask = (key: string) => (key.length <= 12 ? '••••' : `${key.slice(0, 6)}…${key.slice(-4)}`)

export function Ready({ settings, credentials, onChange }: { settings: Settings; credentials: Credentials; onChange(): void }) {
  const [status, setStatus] = useState<PageStatus | null | undefined>(undefined)
  const rows = useRef<(HTMLButtonElement | null)[]>([])
  useEffect(() => {
    let cancelled = false
    void pageStatus().then(s => {
      if (!cancelled) setStatus(s)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const choose = (level: Level, focus: boolean) => {
    void patchSettings({ level })
    if (focus) rows.current[level - 1]?.focus()
  }
  const onKey = (e: KeyboardEvent) => {
    const step = (d: number) => ((((settings.level - 1 + d) % 3) + 3) % 3) + 1
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') choose(step(1) as Level, true)
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') choose(step(-1) as Level, true)
    else return
    e.preventDefault()
  }

  return (
    <>
      <Brand />
      <div className="layers" role="radiogroup" aria-label={COPY.layersLabel} onKeyDown={onKey}>
        {LAYERS.map(layer => (
          // biome-ignore lint/a11y/useSemanticElements: a styled row, not a native radio — same pattern as the page menu (src/content/ui/page-ui.ts)
          <button
            key={layer.level}
            ref={el => {
              rows.current[layer.level - 1] = el
            }}
            type="button"
            role="radio"
            className="row"
            aria-checked={settings.level === layer.level}
            tabIndex={settings.level === layer.level ? 0 : -1}
            data-lit={layer.level <= settings.level ? '' : undefined}
            onClick={() => choose(layer.level, false)}
          >
            <span className="stroke" aria-hidden="true">
              {layer.tones.map(t => (
                <i key={t} style={{ background: `var(--jp-${t})` }} />
              ))}
            </span>
            <span>{layer.name}</span>
          </button>
        ))}
      </div>
      <div className="rule" />
      {/* Stable from first paint, empty until the status arrives (spec §13): a role="status" region must exist
          before its content changes for the change to be announced. */}
      <p className="status" role="status">
        {status !== undefined && (
          <>
            <span className="dot" data-state={status?.state ?? 'idle'} aria-hidden="true" />
            {statusLine(status)}
          </>
        )}
      </p>
      <div className="account">
        <span>
          {COPY.setup.providers[credentials.provider]} · <span className="mono">{mask(credentials.apiKey)}</span>
        </span>
        <button type="button" className="link" onClick={onChange}>
          {COPY.ready.change}
        </button>
      </div>
      <div className="footer">
        <button
          type="button"
          className="link"
          onClick={() => void browser.tabs.create({ url: browser.runtime.getURL('/guide.html') })}
        >
          {COPY.ready.guideAgain}
        </button>
      </div>
    </>
  )
}
