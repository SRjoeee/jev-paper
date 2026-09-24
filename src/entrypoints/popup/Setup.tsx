import { type FormEvent, useRef, useState } from 'react'
import { keysUrl, originPattern } from '@/background/jev/providers'
import { COPY } from '@/shared/copy'
import { type Credentials, type ProviderId, saveCredentials } from '@/shared/credentials'
import { send } from '@/shared/messages'
import { getSettings, patchSettings } from '@/shared/settings'
import { Brand } from './Brand'

type SetupError = keyof typeof COPY.setup.errors
const PROVIDERS: ProviderId[] = ['openrouter', 'typesafe', 'custom']
/** https anywhere, or plain http on this machine (a local proxy) */
const ENDPOINT = /^(https:\/\/[^/\s]+|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)\/\S*$/
/** On a custom endpoint these errors are about the address, not the key (spec §13: an error moves focus to the field it concerns) */
const ENDPOINT_ERRORS: SetupError[] = ['endpoint', 'permission', 'not-jev']

export function Setup({ initial, onDone }: { initial: Credentials; onDone(): void }) {
  const [provider, setProvider] = useState<ProviderId>(initial.provider)
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(initial.baseUrl)
  const [model, setModel] = useState(initial.model)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<SetupError | null>(null)
  const keyRef = useRef<HTMLInputElement>(null)
  const endpointRef = useRef<HTMLInputElement>(null)
  // A ref, not just `busy` state: two rapid calls of `submit` before the first re-render must still see each other
  const busyRef = useRef(false)

  const isEndpointError = (code: SetupError) => provider === 'custom' && ENDPOINT_ERRORS.includes(code)

  const fail = (code: SetupError) => {
    setError(code)
    setBusy(false)
    busyRef.current = false
    ;(isEndpointError(code) ? endpointRef : keyRef).current?.focus()
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busyRef.current) return
    const key = apiKey.trim()
    const url = baseUrl.trim()
    if (provider === 'custom' && !(ENDPOINT.test(url) && model.trim())) return fail('endpoint')
    if (!key) return fail('empty')
    busyRef.current = true
    setBusy(true)
    setError(null)
    // The permission prompt must come straight from the click: nothing is awaited before it
    if (provider === 'custom' && !(await browser.permissions.request({ origins: [originPattern(url)] }))) return fail('permission')
    const reply = await send({ type: 'validate', provider, baseUrl: url, model: model.trim(), apiKey: key })
    if (!reply.ok) return fail(reply.error === 'no-key' || reply.error === 'aborted' ? 'busy' : reply.error)
    await saveCredentials({ provider, baseUrl: url, model: model.trim(), apiKey: key })
    if (!(await getSettings()).guideSeen) {
      await patchSettings({ guideSeen: true })
      await browser.tabs.create({ url: browser.runtime.getURL('/guide.html') })
    }
    setBusy(false)
    busyRef.current = false
    onDone()
  }

  const endpointScoped = error !== null && isEndpointError(error)
  const keyError = error !== null && !endpointScoped
  const link = keysUrl(provider)
  return (
    <form onSubmit={submit} noValidate>
      <Brand />
      <p className="lede">{COPY.lede}</p>
      <fieldset className="seg">
        <legend className="sr">{COPY.setup.providerLabel}</legend>
        {PROVIDERS.map(p => (
          <label key={p} className="seg-item">
            <input
              className="sr"
              type="radio"
              name="provider"
              value={p}
              checked={provider === p}
              onChange={() => {
                setProvider(p)
                setError(null)
              }}
            />
            {COPY.setup.providers[p]}
          </label>
        ))}
      </fieldset>
      {provider === 'custom' && (
        <>
          <div className="field">
            <label htmlFor="jp-endpoint">{COPY.setup.endpointLabel}</label>
            <input
              ref={endpointRef}
              id="jp-endpoint"
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              placeholder={COPY.setup.endpointPlaceholder}
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              aria-invalid={endpointScoped || undefined}
              aria-describedby={endpointScoped ? 'jp-error' : undefined}
            />
            {endpointScoped && error && (
              <p className="error" id="jp-error">
                {COPY.setup.errors[error]}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="jp-model">{COPY.setup.modelLabel}</label>
            <input id="jp-model" type="text" autoComplete="off" spellCheck={false} placeholder={COPY.setup.modelPlaceholder} value={model} onChange={e => setModel(e.target.value)} />
          </div>
        </>
      )}
      <div className="field">
        <label htmlFor="jp-key">{COPY.setup.keyLabel}</label>
        <input
          ref={keyRef}
          id="jp-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={COPY.setup.keyPlaceholder[provider] || undefined}
          value={apiKey}
          onChange={e => {
            setApiKey(e.target.value)
            setError(null)
          }}
          aria-invalid={keyError || undefined}
          aria-describedby={keyError ? 'jp-error' : undefined}
        />
        <div className="hint">
          {link && provider !== 'custom' ? (
            <a href={link} target="_blank" rel="noreferrer">
              {COPY.setup.getKey[provider]}
            </a>
          ) : (
            <span />
          )}
          <span>{COPY.setup.localOnly}</span>
        </div>
        {keyError && error && (
          <p className="error" id="jp-error">
            {COPY.setup.errors[error]}
          </p>
        )}
      </div>
      <button className="primary" type="submit" disabled={busy}>
        {busy && <span className="spinner" aria-hidden="true" />}
        {COPY.setup.submit}
      </button>
    </form>
  )
}
