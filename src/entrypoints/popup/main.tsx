import '@/shared/tokens.css'
import '@/shared/layers.css'
import './popup.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'

document.body.classList.add('jp-theme')
document.body.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
// Opened as a tab (the page's 「点这里去设置」), not from the toolbar: centre the card
if (window.innerWidth > 400) document.body.classList.add('tab')
createRoot(document.getElementById('root')!).render(<App />)
