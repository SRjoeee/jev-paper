// Copied from Read arXiv src/core/paper-id.ts@3f3c91f8 (GPL-3.0), 2026-09-24.
// An arXiv paper id as it appears in a URL path. One place, because three pages carry the same shapes: the HTML
// full text, the abstract page and the PDF (§4.0b).

/** New style since 2007, five digits since 2015 (`1501.00001`), optionally versioned */
const NEW_STYLE = /^\d{4}\.\d{4,5}(v\d+)?$/
/**
 * Old style, with its optional subject class: `hep-th/9711200`, `math.GT/0309136`, `cond-mat.mes-hall/0601001` — a
 * class is not always two capitals, and arXiv serves a PDF under any of these paths (Codex on #288). The same shape
 * the full text's parser takes (core/pipeline/paper.ts)
 */
const OLD_STYLE = /^[a-z-]+(\.[A-Za-z-]+)?\/\d{7}(v\d+)?$/

/**
 * The id under `/<section>/…`, or null when the path is not a paper's.
 *
 * The version the reader opened is kept: what is offered on a PDF or an abstract page must be the version in front
 * of them, not the latest.
 */
export function paperIdFrom(pathname: string, section: 'pdf' | 'abs' | 'html'): string | null {
  const prefix = `/${section}/`
  if (!pathname.startsWith(prefix)) return null
  const path = pathname.slice(prefix.length).replace(/\.pdf$/, '').replace(/\/$/, '')
  return NEW_STYLE.test(path) || OLD_STYLE.test(path) ? path : null
}
