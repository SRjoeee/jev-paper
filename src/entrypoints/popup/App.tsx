import { useEffect, useState } from 'react'
import { type Credentials, getCredentials, hasKey, watchCredentials } from '@/shared/credentials'
import { getSettings, type Settings, watchSettings } from '@/shared/settings'
import { Ready } from './Ready'
import { Setup } from './Setup'

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [credentials, setCredentials] = useState<Credentials | null>(null)
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    void getSettings().then(setSettings)
    void getCredentials().then(setCredentials)
    const stopSettings = watchSettings(setSettings)
    const stopCredentials = watchCredentials(setCredentials)
    return () => {
      stopSettings()
      stopCredentials()
    }
  }, [])
  if (!settings || !credentials) return null
  return (
    <main className="popup">
      {!hasKey(credentials) || editing ? (
        <Setup initial={credentials} onDone={() => setEditing(false)} />
      ) : (
        <Ready settings={settings} credentials={credentials} onChange={() => setEditing(true)} />
      )}
    </main>
  )
}
