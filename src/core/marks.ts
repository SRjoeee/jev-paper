// Copied from Read arXiv src/core/marks.ts@3f3c91f8 (GPL-3.0), 2026-09-24.
// The marks shared by injected nodes: translations, mirrors and split copies all carry axt-t (the prefix of CLAUDE.md
// hard rule 2). At the top of core: the extractor and the protector have to treat these nodes as air (on a
// retranslation they are already inside the original block), yet must not depend on the renderer in turn.
export const T_CLASS = 'axt-t'
/**
 * The image overlay (DESIGN §15.2): the third injected mark, **without** axt-t — with it, side's pairing grid would
 * put it in the right column, a split would remove the <img> as a pair's original, mirrors would be suppressed and
 * twenty style presets would decorate it. It is only “our node”, not “a translation node”
 */
export const IMG_CLASS = 'axt-img'
/**
 * The band layer of the hover highlight (DESIGN §7.7): the fourth injected mark. **On `<body>`, outside the body
 * text tree** — absolutely positioned rectangles drawn per line, taking no part in pairing or splitting and undecorated
 * by the presets; inside the body tree it would be handled as a translation node. Removed with INJECTED_SELECTOR on restore
 */
export const HL_CLASS = 'axt-hl'
/**
 * The original-text panel that floats out in translation-only mode (DESIGN §7.7, issue #141): the fifth injected
 * mark. On `<body>` like the band layer, outside the body tree; inside is a clone of the original sentence (no ids, no
 * data-axt-*). Removed with INJECTED_SELECTOR on restore
 */
export const PEEK_CLASS = 'axt-peek'
/** Every injected node: extraction, serialisation, clone clean-up and restore all use this one selector */
export const INJECTED_SELECTOR = `.${T_CLASS}, .${IMG_CLASS}, .${HL_CLASS}, .${PEEK_CLASS}`

/** Is this a node we injected (translation / mirror / split copy / image overlay / band layer / original panel) — extraction and serialisation skip them */
export function isInjected(el: Element): boolean {
  return el.classList.contains(T_CLASS) || el.classList.contains(IMG_CLASS) || el.classList.contains(HL_CLASS) || el.classList.contains(PEEK_CLASS)
}

/** The prefix of every injected attribute (CLAUDE.md hard rule 2) */
export const AXT_ATTR_PREFIX = 'data-axt-'
/** The prefix of every injected class (the same rule); the paper context excludes our own nodes by it */
export const AXT_CLASS_PREFIX = 'axt-'
/**
 * The figure the figure viewer's control stands on, while it shows (DESIGN §15.7): a style rule gives the figure an
 * anchor name by this mark and the browser lays the control out at its corner. Written on a pointer's arrival and
 * taken off when it has gone, on an untranslated page too — the one kind of thing §7.1 lets an original gain
 */
export const VIEWED_ATTR = `${AXT_ATTR_PREFIX}viewed`
/** The frame that clips that figure sideways, where one does — side's half column scrolls a figure wider than itself: the control keeps inside it (§15.7) */
export const VIEWED_FRAME_ATTR = `${AXT_ATTR_PREFIX}viewed-frame`

/**
 * URLs that run script. **None in a clone**: a link's behaviour belongs to the original, and the clone is a copy for
 * reading. Only these two are blocked, with no general URL scrubbing — `data:image/...` is a real inline image in papers
 */
const UNSAFE_URL = /^(?:javascript:|data:text\/html)/i
const URL_ATTRS = ['href', 'xlink:href', 'src', 'action', 'formaction', 'data']

/**
 * Normalised by the URL standard before the scheme is judged, or a control character inside the scheme name gets
 * round it (Codex on #163): `href="java&#10;script:alert(1)"` comes out of HTML parsing as `java\nscript:` with a
 * newline, which the regex misses, while the browser's URL parser strips tabs and newlines **anywhere** and C0
 * controls and spaces from the start — still a `javascript:` URL
 */
const normalizeUrl = (value: string) => {
  const flat = value.replace(/[\t\n\r]/g, '')
  // C0 controls and spaces stripped from the start. Written as code-point comparisons rather than a character class:
  // Biome refuses control characters in a regex, and exactly the whole range U+0000–U+0020 is wanted here
  let i = 0
  while (i < flat.length && flat.charCodeAt(i) <= 0x20) i += 1
  return flat.slice(i)
}

/**
 * The clean-up of a clone before it enters the page: injected nodes already inside the clone are removed (somebody
 * else's translation / mirror gets copied in whole), then every id is stripped (no duplicate anchors, DESIGN §6.4) and
 * every data-axt-* mark (the original block and a footnote filled back may both carry block marks). Mirrors,
 * translated tables, the fill-back and the split figures each had a near-identical copy of this, and they drifted
 * (issue #46); now there is one. `includeRoot=false` is for a root that is a freshly made translation shell, cleaning
 * only the subtree moved into it.
 *
 * **Behaviour attributes go too** (2026-09-11, measured by the independent audit B17): a clone filled back carried the
 * original node's `onclick`, and a click really ran it — the copy in a translation is for reading and must not be a
 * second trigger, and the same behaviour twice on one page is wrong in itself. arXiv's LaTeXML emits no event
 * attributes, so there is no exposure today; this fixes the invariant rather than a known fault. Read Frog's
 * `sanitizeInlineAtomClone` does the same
 */
export function stripInjected(root: Element, includeRoot = true): void {
  for (const stale of Array.from(root.querySelectorAll(INJECTED_SELECTOR))) stale.remove()
  stripAttributes(root, includeRoot)
}

/**
 * The attribute half of the clean-up alone: ids, our marks, behaviour attributes and script URLs go, every node stays.
 * For a copy that keeps some of our nodes on purpose — the figure viewer's, which shows the translations the page
 * showed (DESIGN §15.7) — and must still be a copy for reading: it used to strip ids and marks by hand and left the
 * rest (Devin on #279)
 */
export function stripAttributes(root: Element, includeRoot = true): void {
  const targets = Array.from(root.querySelectorAll('*'))
  if (includeRoot) targets.unshift(root)
  for (const el of targets) {
    el.removeAttribute('id')
    for (const name of el.getAttributeNames()) {
      if (name.startsWith(AXT_ATTR_PREFIX) || name.toLowerCase().startsWith('on')) el.removeAttribute(name)
      else if (URL_ATTRS.includes(name.toLowerCase()) && UNSAFE_URL.test(normalizeUrl(el.getAttribute(name) ?? ''))) el.removeAttribute(name)
    }
  }
}
