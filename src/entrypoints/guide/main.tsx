import '@/shared/tokens.css'
import '@/shared/layers.css'
import './guide.css'
import { COPY } from '@/shared/copy'
import { applyTheme } from '@/shared/theme'
import { createRoot } from 'react-dom/client'
import { Guide } from './Guide'

document.title = COPY.guide.title
document.body.classList.add('jp-theme')
applyTheme(document.body, matchMedia('(prefers-color-scheme: dark)'))
createRoot(document.getElementById('root')!).render(<Guide />)
