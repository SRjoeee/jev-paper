import '@/shared/tokens.css'
import '@/shared/layers.css'
import './popup.css'
import { LANG } from '@/shared/copy'
import { LANG_TAG } from '@/shared/lang'
import { applyTheme } from '@/shared/theme'
import { createRoot } from 'react-dom/client'
import { App } from './App'

document.documentElement.lang = LANG_TAG[LANG]
document.body.classList.add('jp-theme')
applyTheme(document.body, matchMedia('(prefers-color-scheme: dark)'))
// Opened as a tab (from the page button's "go to settings" action), not from the toolbar: centre the card
if (window.innerWidth > 400) document.body.classList.add('tab')
createRoot(document.getElementById('root')!).render(<App />)
