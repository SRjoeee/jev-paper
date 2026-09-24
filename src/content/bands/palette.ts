import type { Tone } from '@/shared/levels'

export type Theme = 'light' | 'dark'

/**
 * Opaque colours: bands sit behind the text on the page background, and opacity would stack into seams where
 * bands meet. Light values are the spec's (§5.3). Dark values keep each hue at low vividness near arXiv's dark
 * background (#282623) and are gated by the contrast test; the owner approves them from screenshots (Task 15).
 */
export const BAND_COLORS: Record<Theme, Record<Tone, readonly [fill: string, hover: string]>> = {
  light: { claim: ['#e3ecff', '#cfdfff'], evidence: ['#ffe58f', '#ffd95a'], candidate: ['#fff3c9', '#ffe9a0'], caveat: ['#ffdde8', '#ffc9da'] },
  dark: { claim: ['#26334d', '#2f3f5f'], evidence: ['#4d4012', '#5e4f16'], candidate: ['#373019', '#433a1e'], caveat: ['#4a2635', '#5a2e41'] },
}

/** arXiv's own colours, from arxiv-html-papers-theme-20260807.css (`--text-color`, `--link-text-color`, `--background-color`) */
export const ARXIV = {
  light: { text: '#000000', link: '#1b7cac', background: '#ffffff' },
  dark: { text: '#f9f7f7', link: '#2198d4', background: '#282623' },
} as const

const channel = (c: number) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16)
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
}

/** WCAG 2 contrast ratio */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p)
  return (x! + 0.05) / (y! + 0.05)
}

const TONES: Tone[] = ['claim', 'evidence', 'candidate', 'caveat']

/** The document-level style sheet of the band layer (::part and shadow roots cannot reach a layer behind the page) */
export function bandCss(): string {
  const vars = (t: Theme) => TONES.map(tone => `--jp-${tone}:${BAND_COLORS[t][tone][0]};--jp-${tone}-hover:${BAND_COLORS[t][tone][1]}`).join(';')
  return [
    '.jevpaper-bands{position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:-1}',
    `.jevpaper-bands[data-theme="light"]{${vars('light')}}`,
    `.jevpaper-bands[data-theme="dark"]{${vars('dark')}}`,
    '.jevpaper-bands>i{position:absolute;display:block;pointer-events:none;background-color:var(--jp-fill)}',
    ...TONES.map(t => `.jevpaper-bands>i[data-tone="${t}"]{--jp-fill:var(--jp-${t})}.jevpaper-bands>i.hot[data-tone="${t}"]{--jp-fill:var(--jp-${t}-hover)}`),
    '@media (prefers-reduced-motion:no-preference){.jevpaper-bands>i{transition-property:background-color;transition-duration:140ms;transition-timing-function:ease-out}}',
  ].join('\n')
}
