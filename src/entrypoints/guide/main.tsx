import '@/shared/tokens.css'
import './guide.css'
import { applyTheme } from '@/entrypoints/popup/theme'
import { createRoot } from 'react-dom/client'
import { Guide } from './Guide'

document.body.classList.add('jp-theme')
applyTheme(document.body, matchMedia('(prefers-color-scheme: dark)'))
createRoot(document.getElementById('root')!).render(<Guide />)
