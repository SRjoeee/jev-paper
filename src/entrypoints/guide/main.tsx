import '@/shared/tokens.css'
import '@/shared/layers.css'
import './guide.css'
import { COPY, LANG } from '@/shared/copy'
import { LANG_TAG } from '@/shared/lang'
import { applyTheme } from '@/shared/theme'
import { createRoot } from 'react-dom/client'
import { Guide } from './Guide'

document.documentElement.lang = LANG_TAG[LANG]
document.title = COPY.guide.title
document.body.classList.add('jp-theme')
applyTheme(document.body, matchMedia('(prefers-color-scheme: dark)'))
createRoot(document.getElementById('root')!).render(<Guide />)
