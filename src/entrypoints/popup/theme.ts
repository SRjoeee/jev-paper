/**
 * Applies the OS theme to `data-theme` on `root` and keeps it live: the popup opened in a tab by 「open-setup」
 * can stay open across a theme change. Returns a cleanup that stops listening.
 */
export function applyTheme(root: HTMLElement, mql: MediaQueryList): () => void {
  const apply = () => {
    root.dataset.theme = mql.matches ? 'dark' : 'light'
  }
  apply()
  mql.addEventListener('change', apply)
  return () => mql.removeEventListener('change', apply)
}
