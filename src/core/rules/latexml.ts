// Copied from Read arXiv src/core/rules/latexml.ts@3f3c91f8 (GPL-3.0), 2026-09-24.
import { LETTER, collectText, squash } from '@/core/text'
// The LaTeXML rules module. Every ltx_* selector lives in this file only (CLAUDE.md, the first of the two defaults).
// Based on DESIGN.md §5.1 / §5.2 / §5.3 / §5.6 / §6.1; the measurements are in DESIGN §5.7.
// Data tables and pure functions only, no traversal; the traversal is in src/core/extractor.

/**
 * Bumped on every behaviour change of a table or function; enters the cache key. 0.5.0: cells at any depth, units
 * inside a cell serialised by walking in (§5.3). 0.6.2: tags carrying an environment name became translatable, bare
 * identifiers (`(a)`, `(ii)`) stay protected — the classification changed meaning, and the old cache must not carry
 * over (Codex on #53). 0.10.1: `.ltx_nodisplay` is a void — the cached blocks had translated the hidden accessibility
 * descriptions along, and would keep serving them with the key unchanged. 0.10.2: an inline listing is a void
 * (`lstinline`) — its identifiers had gone to the engine as prose
 */
export const RULES_VERSION = '0.11.0'

/** The LaTeXML class prefix, to tell whether an element belongs to the paper body */
export const LTX_CLASS_PREFIX = 'ltx_'

/** The translation root: nothing outside it (the navigation bar, the header, footer and pop-ups arXiv injects) is extracted */
export const DOCUMENT_ROOT = 'article.ltx_document'

export interface Rule {
  id: string
  selector: string
  note: string
}

/** descend: a void to the outer unit, yet possibly holding independent blocks inside (footnotes) the extractor has to go on down into */
export interface ProtectRule extends Rule {
  descend?: boolean
}

/**
 * The equation-group container. **Not limited to `table`**: LaTeXML also emits groups in span form (measured on
 * 2312.17141: 2 of its 26 groups are `<span class="ltx_equationgroup …">`, both inside translation units). Narrowed
 * to `table.`, the span ones would lose their whole-block protection — the outer unit would serialise the whole group
 * as one paired wrapper plus a string of independent voids, and a provider is **allowed to reorder placeholders**, so
 * equation rows could change places in the translation clone (Codex on #168). Only rendering and splitting are
 * limited to the table form (see EQUATION_GROUP_TABLE)
 */
const EQUATION_GROUP = '.ltx_equationgroup'

/** The equation group in table form: the only one with `<tr>` rows, and the only one worth splitting in two */
const EQUATION_GROUP_TABLE = 'table.ltx_equationgroup'

/**
 * The description row inside an equation group (`\intertext`): `tr.ltx_eqn_row` **without** `.ltx_equation`.
 * A spacing row in the group has the same shape, but its cell is empty, and `extract`'s “a block needs letters” keeps it out of itself
 */
export const EQN_PROSE_ROW = 'tr.ltx_eqn_row:not(.ltx_equation)'

/** §5.1 translation units: a match holding translatable text becomes a block, and the walk goes on down to find nested units */
export const UNIT_RULES: readonly Rule[] = [
  { id: 'p', selector: '.ltx_p', note: 'body paragraph, possibly a <span>; paragraphs in the abstract, list items and theorems are all covered here' },
  // The run-in headings of the acknowledgements and the keywords are no blocks of their own: their container is itself
  // a unit (the body is bare text inside it), and a block for the heading too would make the outer block clone it as
  // a void placeholder in English — two English headings and one Chinese body on the page (measured on 2609.00095).
  // As no block, it is a paired placeholder, translated with the outer and put back in place
  { id: 'title', selector: '.ltx_title:not(.ltx_title_acknowledgements):not(.ltx_title_keywords), .ltx_subtitle', note: 'headings of every level, subtitles, theorem run-in headings; the .ltx_tag inside is a void' },
  { id: 'caption', selector: '.ltx_caption', note: 'figure and table captions; the .ltx_tag inside is a void' },
  { id: 'footnote', selector: '.ltx_note_content', note: 'footnote body, a block of its own; inside the .ltx_note container' },
  // References: an entry is translated per .ltx_bibblock fragment, the translation right under its own line (§5.4);
  // since 2026-09-06 the author fragment is no longer skipped on its own — in a single-fragment entry the author
  // names are translated with the whole entry anyway, and skipping only made the two templates behave differently
  // (§5.4); an entry without fragments (natbib and the like) is one unit whole, as the fallback
  { id: 'bibblock', selector: '.ltx_bibblock', note: 'a fragment of a reference entry (authors / title / venue), see §5.4' },
  { id: 'bibitem', selector: '.ltx_bibitem:not(:has(.ltx_bibblock))', note: 'a reference entry without fragments, one unit whole' },
  { id: 'ack', selector: '.ltx_acknowledgements', note: 'acknowledgements' },
  { id: 'keywords', selector: '.ltx_keywords', note: 'keywords' },
  // The author area is translated by default (§5.2 revised): affiliations, contact details and dates are informative
  // text; e-mail addresses are excluded separately by protect's mailto. Names too since 2026-09-06 (the decision of
  // §5.2): the old objection was “a transliterated name breaks citation search”, but in a bilingual reader the
  // original name sits beside the translated one; only translation-only mode hides the original, and that is that
  // mode's trade-off for all content
  { id: 'personname', selector: '.ltx_personname', note: 'author name; a span inside .ltx_creator, so the translation as a sibling is inline of itself' },
  { id: 'authorinfo', selector: '.ltx_contact, .ltx_role_affiliation, .ltx_role_address, .ltx_dates, .ltx_date', note: 'the authors\' affiliations, contact details and dates' },
  // The structures below did not occur in any real paper fetched; tests/fixtures/arxiv/synthetic-structures.html guards them (DESIGN §5.7)
  { id: 'dedicatory', selector: '.ltx_role_dedicatory', note: 'dedication' },
  { id: 'item', selector: '.ltx_item', note: 'the bare text of a list item / description term; with a .ltx_p inside, the p rule takes over' },
  // `\intertext`: descriptive text between the equations of a group. LaTeXML renders it as a cell spanning a whole
  // row of the group table (`tr.ltx_eqn_row` without `.ltx_equation`, the cell with `white-space:normal` and the
  // group's colspan), not as a `<p>`. **The unit is the row, not the cell**: the translation is the next sibling
  // (§7.1), and a cell's sibling is the row's second cell — two colspans would stretch the table to twice the columns
  // and squash every equation; the row's sibling is a new row, exactly what is wanted. A spacing row matches too,
  // but its cell is empty and letterless, no block anyway, no special case needed
  { id: 'intertext', selector: EQN_PROSE_ROW, note: 'the \\intertext description row of an equation group (issue #152)' },
  // A TikZ node's label (§15.6): ordinary HTML in the picture's `foreignObject`, in the figure's own face and colour.
  // Its translation is its next sibling like any block's (§7.1) and a style rule shows one of the two, the node's box
  // holding either (modes.css). A wrapped label holds a `.ltx_p` of its own, and then that is the block (rule p)
  { id: 'picturelabel', selector: '.ltx_foreignobject_content', note: 'the label of a TikZ node, HTML inside the picture\'s foreignObject (§15.6)' },
  { id: 'marginal', selector: '.ltx_marginpar', note: 'marginal note' },
  { id: 'indexentry', selector: '.ltx_indexentry', note: 'index entry; the page numbers in .ltx_indexrefs are a placeholder' },
  { id: 'cv', selector: '.ltx_cv_item_label, .ltx_cv_item_content, .ltx_cv_entry_date', note: 'the entry fields of the CV template' },
]

/** §5.3 tables: the outermost .ltx_tabular is one unit (the walk takes the outermost without descending); the cells are the paragraphs of the block, and th carries ltx_td too */
export const TABLE_RULES = { root: '.ltx_tabular', cell: '.ltx_td' } as const

/** The table of a display equation: a single equation and an align group are both this; the rows in a group are tr.ltx_equation (not counted on their own) */
export const EQUATION_TABLE = 'table.ltx_eqn_table'
/** The fill cells on both sides of an equation table: they absorb the surplus of width: 100%, ar5iv gives them min-width: 2em, and a content-width measurement counts them at min-width */
export const EQUATION_PAD_CELL = '.ltx_eqn_center_padleft, .ltx_eqn_center_padright, .ltx_eqn_left_padleft, .ltx_eqn_right_padright'
/** The wide content side mode has to fit into one column (renderer/table-fit.ts): tables and display equations */
export const FIT_TARGETS = `${TABLE_RULES.root}, ${EQUATION_TABLE}`

/**
 * The cell of a description row that holds the text. The renderer takes its **shallow clone** as the shell of the
 * translated row: a row's content must sit in a cell, and a translation hung under `<tr>` directly is not laid out
 * by table layout at all; the shallow clone carries the `colspan` and the alignment class, so the translated row is
 * as wide and as aligned as the original
 */
export function eqnProseCell(row: Element): Element | null {
  if (!row.matches(EQN_PROSE_ROW)) return null
  return row.querySelector(':scope > td')
}

/**
 * The roots split in two in side mode (renderer/split-figures.ts).
 *
 * Beyond figures, **an equation group with a description row**: the equations in the group have no translation and
 * the row alone has one, so pairing by block puts the whole group in the left column and one Chinese line in the
 * right, breaking the alignment; a group across both columns would change the existing layout of “each equation
 * once per column”. Handled like a figure: cloned, each pair's original member removed, so the left column holds
 * the original group and the right the same group with the Chinese description (issue #152)
 */
export const SPLIT_ROOTS = `figure, ${EQUATION_GROUP_TABLE}`

/** Every cell of a table block, in document order and at any depth: a nested tabular's cells are the outer block's cells (§5.3) */
export function tableCells(table: Element): Element[] {
  return Array.from(table.querySelectorAll(TABLE_RULES.cell))
}

/** Is this the root of a table block: a table's sentences are registered per cell, and the split-figure signature walks into the cells (renderer/split-figures.ts) */
export function isTableRoot(el: Element): boolean {
  return el.matches(TABLE_RULES.root)
}

/** The protector has to know at serialisation whether the root is a cell: units inside a cell are no blocks of their own and are walked into (§5.3) */
export function isTableCell(el: Element): boolean {
  return el.matches(TABLE_RULES.cell)
}

/** §5.2 block-level skips: not yielded, not descended. Inside a translation unit (a .ltx_ERROR in a paragraph, say) they are voids to that unit */
export const SKIP_RULES: readonly Rule[] = [
  // `.ltx_equation` matches both the single-equation table `table.ltx_equation` and an equation row in a group
  // `tr.ltx_equation`; both are skipped whole. **The equation group is not here**: it is a container, and beyond the
  // equation rows it may hold an `\intertext` description row, which is body text (PROTECT_RULES' equationgroup +
  // UNIT_RULES' intertext, issue #152)
  { id: 'equation', selector: '.ltx_equation', note: 'display equation: a single equation table, or an equation row inside a group' },
  { id: 'listing', selector: '.ltx_listing, .ltx_listingline, .ltx_listing_data, .ltx_verbatim, pre, code', note: 'code, lines inside an algorithm box, verbatim, hidden listing data' },
  // The author area is no longer skipped whole (§5.2 revised); names too are translated since 2026-09-06 (see
  // UNIT_RULES' personname); only the glue is still blocked: as blocks of their own they would break the author list
  // into one word per line
  { id: 'author-glue', selector: '.ltx_author_before, .ltx_author_after', note: 'the glue between authors (“ and ”, “, ”)' },
  { id: 'classification', selector: '.ltx_classification', note: 'MSC / ACM classification codes, such as “Primary: 11L07”' },
  { id: 'pubnotes', selector: '.ltx_pubnotes', note: 'publication metadata (the ACM template\'s CCS / DOI / journal)' },
  { id: 'error', selector: '.ltx_ERROR, .ltx_FATAL, .ltx_WARNING, .ltx_INFO', note: 'LaTeXML conversion errors and notices, not paper content' },
  { id: 'nav', selector: '.ltx_page_navbar, .ltx_TOC', note: 'the navigation bar and the table of contents; outside the translation root, for the renderer to hide' },
]

/**
 * **Tags carrying an environment name**: LaTeXML also puts the **name** of a theorem environment, a figure, a table,
 * an algorithm or an appendix into .ltx_tag, so “Definition 1.1.” was protected whole as a number, and a Chinese
 * reader still saw English (the owner's feedback, 2026-09-05). These kinds are translated; every other tag is a bare
 * number or symbol and must stay as it is.
 *
 * The evidence is the measurement over all 12 fixtures (1241 `.ltx_tag` in all): all 246 theorem tags are of the
 * form "Definition 1" / "Example 1"; all 43 table tags are "Table 1:"; 58 of 63 figure tags are "Figure 1."; all 20
 * appendix tags are "Appendix A"; all 13 float tags are "Algorithm 1"; part / chapter one each. The other way
 * round, only 13 of the 344 equation tags carry letters (LaTeX labels like "(let.lin)", untouchable), the lettered
 * ones among the 439 section / subsection / ref tags are all Roman numerals (II, III.1), and the 54 note tags are
 * footnote marks.
 *
 * **The class name alone is not enough**: LaTeXML uses `.ltx_tag_figure` for sub-figure panel labels too, whose
 * content is a bare identifier `(a)` `(b)` `(c)` (5 of the 387 named tags, measured on 2410.00260 and 2312.17141;
 * Codex on #53). Translated, these get rewritten or reordered by the model, and the correspondence to the panels
 * breaks. So a content test is added: a tag is translated only when it holds a **word**.
 */
const NAMED_TAGS = [
  '.ltx_tag_theorem', // Definition 1.1 / Theorem 2 / Lemma 3
  '.ltx_tag_figure', // Figure 1.
  '.ltx_tag_table', // Table 1:
  '.ltx_tag_float', // Algorithm 1
  '.ltx_tag_appendix', // Appendix A
  '.ltx_tag_part', // Part I
  // The terms of a description list (`\item[Compactness]`) are placed in the tag as well, and they are real body text
  // (Codex on #18): not opened up, the whole `.ltx_item` has no own text, is no block at all, and the term is never
  // translated. The 12 fixtures hold 371 `.ltx_tag_item`, of which only 8 carry words (Markov categories: / CD
  // categories: / Compactness. / RQ1–RQ5); the other 363 are marks like `(1)` `•`, blocked by the content test
  // below. google-web measured RQ1 returned as it was; an identifier is not rewritten
  '.ltx_tag_item', // Compactness. / Markov categories:
  '.ltx_tag_chapter', // Chapter 1
].join(', ')

/** §6.1 protected inline nodes: void placeholders, not yielded; not descended by default */
export const PROTECT_RULES: readonly ProtectRule[] = [
  { id: 'math', selector: 'math, .ltx_Math', note: 'inline formula; display equations are skipped whole by equation' },
  { id: 'ref', selector: '.ltx_ref', note: 'cross-reference, with the .ltx_ref_tag inside' },
  { id: 'cite', selector: '.ltx_cite', note: 'citation mark' },
  { id: 'tag', selector: '.ltx_tag', note: 'numbers and symbols: section numbers, equation numbers, list bullets, footnote marks, code line numbers; the ones carrying an environment name excepted, see isNamedTag' },
  { id: 'tt', selector: '.ltx_text.ltx_font_typewriter', note: 'monospaced text, taken for code' },
  // `\lstinline`: LaTeXML's listings binding sets it as a `ltx:text` of class `ltx_lstlisting`, **without** the
  // typewriter class the rule above reads (the face comes from the site's style sheet), its tokens in spans of their
  // own — `ltx_lst_identifier`, `ltx_lst_keyword`, a `ltx_lst_space` per space. Walked as text it went to the engine
  // as prose: through the Edge endpoint `let y = sample(D) in y =:= x` came back with `=` doubled, the punctuation
  // full-width and, once the wire set markers apart from words (protector/serialize.ts), `let` and `in` translated.
  // Measured over the 12 fixtures and 39 recent cs.PL / cs.SE papers (2026-09-19): 551 inline listings, all code
  // (8 characters at the median, 56 at most; 30 hold a formula, which the clone keeps), none of them typewriter or
  // inside a block listing, so none was protected; every other carrier of the class is a block listing (skipped
  // already), a float with its caption (must stay open) or an `mrow` / `mtext` inside a formula — hence `.ltx_text`
  { id: 'lstinline', selector: '.ltx_text.ltx_lstlisting', note: 'an inline listing (\\lstinline): code, kept as it is' },
  { id: 'note', selector: '.ltx_note', descend: true, note: 'footnote container: a void to the outer paragraph, while the .ltx_note_content inside is still found as a block' },
  // The same shape as a footnote (issue #152): **one atom to the outer unit** — the whole group is a void, the wire
  // text is byte for byte what it was, and `<table><tbody><tr>` must never go to the engine as paired tags; **but the
  // extractor descends**, since the group may hold an `\intertext` description row, a translation unit of its own.
  // Measured: 5 of the 39 equation groups in the 12 fixtures sit inside a unit such as `.ltx_item`, and either skip
  // or a missing descend would change what those 5 blocks send
  { id: 'equationgroup', selector: EQUATION_GROUP, descend: true, note: 'equation group container: a void to the outer unit, while the description rows inside are still found as blocks' },
  // An inline TikZ picture, the same shape again (§15.6): one atom to an outer unit, entered by the extractor for the
  // labels inside, which are HTML in a `foreignObject` and blocks of their own (UNIT_RULES' picturelabel). Until
  // 2026-09-21 the picture was skipped whole and its labels went the images' way, a white box drawn over each
  { id: 'picture', selector: 'svg, .ltx_picture', descend: true, note: 'TikZ picture: a void to the outer unit, while the labels inside are still found as blocks (§15.6)' },
  { id: 'note-mark', selector: '.ltx_note_mark, .ltx_note_type', note: 'footnote mark and type label (once at the container\'s outer level and once inside the body)' },
  { id: 'mailto', selector: 'a[href^="mailto:"]', note: 'e-mail addresses kept as they are' },
  // The contact labels LaTeXML generates ("Affiliation: " / "Email: "), which arXiv's style sheet sets display:none.
  // Not blocked, the only translatable thing in the e-mail's .ltx_contact is this hidden label, and the translation
  // comes out as an invisible “E-mail:” line plus a copy of the address as it was — two identical e-mail lines on
  // the page (the decision of §5.2)
  { id: 'contact-label', selector: '.ltx_contact_name', note: 'contact label, generated by the template and hidden by the site' },
  // What LaTeXML marks as not displayed — in practice the ACM template's `\Description{}`, the
  // accessibility text behind a figure or table's `aria-describedby`. ar5iv hides it with
  // `.ltx_nodisplay { display: none }`, but our translation is our own node and carries no such
  // class, so translating it printed several hundred words of prose — `\par` macros and all, since
  // LaTeXML leaves those unexpanded — right under the caption (reported on 2509.10652v3's Table 5,
  // 2026-09-11). Left alone it also spends tokens on text nobody reads. Same shape as the
  // `contact-label` rule above: hidden at the source, so it must never reach the engine
  { id: 'nodisplay', selector: '.ltx_nodisplay', note: 'content LaTeXML marks as not displayed (ACM \\Description), hidden by the site' },
  // The citation year (Codex on #74): once `.ltx_bibblock` opened the author fragment (§5.4), the year went to the
  // engine with it. In the serialisation it is a **paired** placeholder, and the protocol protects the tags while
  // **the content stays translatable** — `(2024)` can come back with full-width brackets or a year word added, and
  // the validation looks at the placeholder wrapping only, stopping not a character. In only mode the original is
  // hidden, and what is left is rewritten citation metadata. All 59 measured shapes are
  // `<span class="ltx_text ltx_bib_year"> (2024)</span>`, bare digits with no word to translate; a void is the least fuss
  { id: 'bib-year', selector: '.ltx_bib_year', note: 'citation year, kept as it is (§5.4)' },
  { id: 'indexrefs', selector: '.ltx_indexrefs', note: 'the page-number list after an index entry' },
  { id: 'img', selector: 'img', note: 'inline image' },
  { id: 'br', selector: 'br', note: 'line break' },
]

/**
 * §7.2 the mirror targets of side mode: block-level content with no translation that takes a row of its own.
 * Side by side, the right column needs a copy too, or formulas and figures span both columns and break the reading
 * rhythm. Only **the graphic itself** is mirrored, not the whole figure: the .ltx_caption inside a figure is a
 * translatable block, and mirroring the whole would give the right column an English caption (measured). With the
 * figure as a grid container, the graphic and its mirror take one row and the caption and its translation the next,
 * each column complete. Tables are not here — the whole-table clone is their translation already (§5.3).
 */

export type RuleKind = 'skip' | 'table' | 'unit' | 'protect'

export interface Classification {
  kind: RuleKind
  /** The id of the rule matched; always 'table' for a table */
  rule: string
  /** Whether the extractor goes on down to find nested blocks */
  descend: boolean
}

const TABLE_CLASSIFICATION: Classification = { kind: 'table', rule: 'table', descend: false }

/** §5.6: an element matching several categories takes skip > table > unit > protect; null when none matches */

/** A whole identifier in brackets: a sub-figure panel's `(a)` `(ii)` `(iii)` and an equation label's `(let.lin)` share this shape */
const PARENTHESIZED = /[(（][^)）]*[)）]/g

/**
 * A tag numbered in Roman numerals is never translated: machine translation **localises** it, while the `.ltx_ref`
 * pointing at it is protected original text, and once translated the body and the cross-reference no longer match.
 * Measured 2026-09-05 with google-gtx (Codex on #53):
 *
 * | source | translation |     | source | translation |
 * |---|---|---|---|---|
 * | `Table IV:` | 表四： |  | `Table 4:` | 表 4： |
 * | `Table X:` | 表十： |  | `Appendix A` | 附录A |
 * | `Part I` | 第一部分 |  | `Appendix C` / `D` | 附录C / 附录D |
 *
 * Arabic digits, letter numbering and bracketed panels come back as they were; only Roman numerals are rewritten.
 * Google itself takes only I / V / X / L / M for numerals and a lone C or D for a letter, and the test here follows
 * that. A paper's numbering style is consistent, so a reader never sees “表 4” and “Table IV” together
 */
// Compound numbers count too: the last token of `Table IV.1:` is `IV.1`, of `Theorem IV-A` it is `IV-A`, and a Roman
// first segment gets localised (measured 2026-09-05 with google-gtx: `Table IV.1` → 表四.1). LaTeX's \roman gives
// lower case, localised the same way (`Table iv:` → 表四：, `Theorem ii.3` → 定理二.3), hence case-insensitive (Codex on #53)
const ROMAN_ID = /^(?:[IVXLCDM]{2,}|[IVXLM])(?:[.\-–][A-Za-z0-9]+)*$/i

/**
 * A tag carrying an environment name that really holds a word: `Definition 1.1` is translated, a sub-figure panel's
 * `(a)` `(ii)` must not be.
 *
 * Three steps: **strip everything inside brackets first**, then look for two or more consecutive letters in what
 * is left, then exclude Roman-numeral numbering (see ROMAN_ID). Counting letters alone is not enough — a panel
 * identifier can be a multi-letter Roman numeral like `(ii)` `(iii)` (Codex on #53); and brackets are exactly the
 * shape LaTeXML gives identifiers, while an environment name never comes in brackets (`Definition 1.2 (Hall set)`
 * still holds "Definition" once the brackets are stripped, and is translated all the same)
 */
/**
 * Are the brackets holding “words” rather than an identifier: `(Hall set)`, `(Figure 1)` hold a word that is no Roman
 * numeral and are kept; `(a)`, `(ii)`, `(A.1)` hold only an identifier and are dropped. Stripping the whole would
 * drop an entirely bracketed label like `(Figure 1)` together with its environment name, never to be translated (Codex on #53)
 */
const hasNonRomanWord = (inner: string): boolean =>
  (inner.match(/[A-Za-z]{2,}/g) ?? []).some(word => !ROMAN_ID.test(word))

export function isNamedTag(el: Element): boolean {
  if (!el.matches(NAMED_TAGS)) return false
  const text = (el.textContent ?? '').replace(PARENTHESIZED, group => (hasNonRomanWord(group) ? group : ''))
  if (!/[A-Za-z]{2,}/.test(text)) return false
  // The number token at the end: `Table XIII:` → `XIII`. Punctuation off first, then trim: `Table IV :` with its colon
  // removed ends in a space, and untrimmed pop() would get an empty string and the Roman test would be bypassed (Codex on #53)
  const last = text.replace(/[\s.:：。()（）]+$/, '').trim().split(/\s+/).pop() ?? ''
  return !ROMAN_ID.test(last)
}

/**
 * Units hidden inside a container that is “an atom to the outer unit”, which **give way when the outer really becomes
 * a block**.
 *
 * Today only the description row of an equation group: the outer becoming a block means it has cloned the whole
 * group into its own translation as a void, and a block for the row on top puts two copies on the page — one in
 * English inside the outer's clone, one in Chinese inside the group — and the split makes a third under the
 * original. A footnote in the same shape is placed by `localizeNotes`; an equation group has no such step.
 *
 * **The criterion is “the outer really became a block”, not “an ancestor matches a unit selector”** (Codex on #168):
 * an `.ltx_item` holding only a nested `.ltx_p` and an equation group has no ownText of its own and is no block at
 * all, nobody clones that group, and the description row would be suppressed by mistake, a whole passage
 * untranslated. So the extractor decides — only it knows which units really yielded blocks
 */
export const YIELDS_TO_OUTER_BLOCK: ReadonlySet<string> = new Set(['intertext'])

/**
 * The containers the extractor does **not** enter once an outer unit became a block. A picture inside a paragraph
 * that is a block was cloned whole into that paragraph's translation, labels and all, and any unit found inside —
 * a label, or the `.ltx_p` of a wrapped one, which no list of giving-way units could name without taking every
 * paragraph in a footnote with it — would be translated a second time beside the clone. A footnote and an equation
 * group are entered all the same: their inner blocks are placed by steps of their own
 */
export const CLOSED_UNDER_OUTER_BLOCK: ReadonlySet<string> = new Set(['picture'])

export function classify(el: Element): Classification | null {
  const skip = SKIP_RULES.find(r => el.matches(r.selector))
  if (skip) return { kind: 'skip', rule: skip.id, descend: false }
  if (el.matches(TABLE_RULES.root)) return TABLE_CLASSIFICATION
  const unit = UNIT_RULES.find(r => el.matches(r.selector))
  if (unit) return { kind: 'unit', rule: unit.id, descend: true }
  const protect = PROTECT_RULES.find(r => el.matches(r.selector))
  // A tag carrying an environment name is no void: it holds words like Definition / Table / Algorithm that are translated
  if (protect?.id === 'tag' && isNamedTag(el)) return null
  if (protect) return { kind: 'protect', rule: protect.id, descend: protect.descend ?? false }
  return null
}

/**
 * **Inline elements with behaviour**: lost, their content is still there but their behaviour is gone. The runs
 * fallback keeps such nodes whole (§6.5, issue #44). The links in arXiv body text are almost all .ltx_ref or mailto,
 * blocked by PROTECT_RULES already; this is the fallback for plain <a> and for other sites in v2
 */
export const FUNCTIONAL_INLINE = 'a[href]'

/**
 * Formatting-only inline elements, which the markers format flattens to text (§6.3). One that
 * opens a block — `Keywords:`, `Note.`, an italic theorem statement — can be put back at rehydrate
 * time along its separator (protector/label.ts, issue #150). Not `.ltx_font_typewriter`: that is
 * kept whole as code and never flattened.
 */
export const LABEL_FORMATTING = '.ltx_font_bold, .ltx_font_italic, .ltx_font_smallcaps, .ltx_emph'

/**
 * What may be put back around a block that is **wholly inside it**: any formatting-only element — LaTeXML's
 * `ltx_text`, which carries a face, a size or a colour (`--ltx-fg-color` on its style), and the emphasis element.
 * Wider than the labels' list because nothing is guessed: with no body after it there is no separator to find, and
 * every word of the translation goes back inside. Measured over 13 papers, 938 of 6 855 units are such (13.7 %):
 * 720 paragraphs, 167 picture labels, 51 reference fragments — and a picture's label is nearly always one, its
 * colour and face on the span inside (§15.6). Code is not among them: it went out as a placeholder
 */
export const WHOLE_FORMATTING = `.ltx_text, .ltx_emph, ${LABEL_FORMATTING}`

/** Figures and graphics (for the Phase 0 statistics script) */
/**
 * Image targets (§15). Both kinds of `graphics` are taken: a bitmap goes to OCR, an SVG has its glyphs read
 * directly (§15.5). Measured: these `<object>`s carry `.ltx_graphics` like the bitmaps
 */
export const FIGURE_SELECTORS = {
  figure: '.ltx_figure',
  graphics: 'img.ltx_graphics, object.ltx_graphics[type="image/svg+xml"]',
  /** What a reader may open large (issue #276): the two above and an inline TikZ picture, which is a figure though no image target */
  viewable: 'img.ltx_graphics, object.ltx_graphics[type="image/svg+xml"], svg.ltx_picture',
} as const

/** Footnotes (for the two-column placement of §7.2): the container, the body, the body's class name and the number it carries */
/**
 * Annotation placeholders (§8.6): treated as spaces when sentences are cut, hiding what they say.
 *
 * **Footnotes only.** Citations are not here: the `.ltx_cite` of `\citet` can be a sentence's subject (“Smith et al.
 * proved …”), and taken for an annotation it would be blanked to a space and hide the sentence boundary before it,
 * merging two sentences into one (Codex on #137). The class name cannot tell `\citet` from `\citep`, and letting a
 * citation hand over its own text through `textOf` is right either way: as a subject it reads as a subject, and as a
 * bracketed note at the end of a sentence it ends in `)` and makes no false boundary
 */
export const ANNOTATION_SELECTOR = '.ltx_note, .ltx_note_mark, .ltx_note_type'

export const NOTE = {
  root: '.ltx_note',
  /** A note of the title area (thanks, affiliations): with a translation it returns to the article's flow and pairs (§7.2) */
  frontmatter: '.ltx_note.ltx_note_frontmatter',
  content: '.ltx_note_content',
  contentClass: 'ltx_note_content',
  marks: '.ltx_note_mark, .ltx_tag',
  /** The note's box, which ar5iv floats to the page's edge; neither a sentence's ranges nor a grid row's height should include it */
  outer: '.ltx_note_outer',
  /**
   * The boxes that hang in the page's margin: body footnotes, not the frontmatter notes (a
   * frontmatter note with a translation goes back into the article's flow, §7.2). This is what
   * `renderer/margin-notes.ts` stacks down the gutter
   */
  marginOuter: '.ltx_note:not(.ltx_note_frontmatter) > .ltx_note_outer',
} as const

/** Figures split whole (§7.2): media with no translation that cannot be translated — exactly what each column needs a copy of */
export const FIGURE_MEDIA = 'img, svg, object, math, canvas, video, .ltx_picture'

/**
 * What ar5iv itself hangs at the page's outer edge: publication metadata (DOI / journal / CCS) and footnote content
 * both float out of the article with `float: inline-end` and a negative margin. They have no translation, a mirror
 * would only duplicate them in the other column, and the floating content of the left column's copy would land on
 * the neighbouring column (measured on 2312.17141: the original's content floated to 1320→1752, over the right
 * column). Unmirrored it spans both columns of itself and the floating content returns to the page's right edge
 * (measured 2084→2516, as in the original layout).
 */
export const MARGIN_ASIDE = '.ltx_pubnotes, .ltx_note'
/**
 * The boxes the page's margin content **actually paints**, for renderer/peek.ts to measure whether
 * the margin is free. A `.ltx_note` root is an inline anchor a few pixels wide; what floats out is
 * the box inside it, and in side mode that box is zero-height (modes.css), so the content is measured.
 */
export const MARGIN_ASIDE_BOXES = '.ltx_pubnotes, .ltx_note_content'

/** The document's main title: centred with text-align:center, never on one line with its translation (§7.3) */
/**
 * The LaTeXML selectors the structural decisions of side mode need (DESIGN §7.2). The rule tables answer “which
 * content is translated”; these answer “what structure that content has” — LaTeXML knowledge all the same, placed
 * here by CLAUDE.md's selector default, and the renderer (`renderer/side-layout.ts`) only composes them and writes no
 * `ltx_` (Codex on #22). `styles/modes.css` holds the same list — style sheets may name `ltx_` for layout — and
 * tests keep the two in step.
 */
export const SIDE_LAYOUT = {
  /** A multi-panel flex figure: a `.ltx_flex_figure` with any cell that is not full width (`ltx_flex_size_1`) */
  multiPanelFlex: '.ltx_flex_figure:has(> .ltx_flex_cell:not(.ltx_flex_size_1))',
  /** A list item with its marker as a child: the marker leaves the pairing grid's flow and hangs in each column (§7.2) */
  taggedItem: '.ltx_item:has(> .ltx_tag)',
  /**
   * Inline and preformatted contexts: turned into grids they are ruined.
   * **The `\resizebox` wrapper excepted** (`.ltx_transformed_outer`, measured 2026-09-07 on 2606.07636v2): though it
   * carries `.ltx_inline-block`, it is no inline context but a block-level shell around one thing — ar5iv's own style
   * sheet flattens its `width` / `height` and the inner `transform` with `!important` (`.ltx_table >
   * .ltx_transformed_outer > .ltx_transformed_inner { width: initial !important; transform: none !important }`), so
   * the scaling never applies. Excluded as an inline context, the table pair inside cannot reach the two column
   * lines: the original and the translated table become two `inline-table`s, centred on one line inside the
   * full-width shell, across the divider (measured: all 5 tables over the line; a wide table wraps and takes the full width each)
   */
  atomicContext: '.ltx_inline-block:not(.ltx_transformed_outer), .ltx_note, .ltx_listing',
  /** A pair member itself: a translation inside it is the footnote kind of nesting, not its own counterpart */
  pairMember: '.ltx_p, .ltx_title, .ltx_caption, .ltx_bibblock',
  /** Footnotes: the collapsed state lives in the display of `.ltx_note_outer`; the whole subtree is excluded */
  note: '.ltx_note',
  /** Stack regions: these cells have no right column, and the pairs fall back to stacking. The `\resizebox` wrapper is excepted here too, for the reason under atomicContext */
  stack: '.ltx_td, .ltx_inline-block:not(.ltx_transformed_outer)',
} as const

export const DOCUMENT_TITLE = '.ltx_title_document'
/** The document subtitle (`\subtitle`): part of the centred title area like the document title, and likewise no same-line candidate */
const DOCUMENT_SUBTITLE = '.ltx_subtitle'

/** The abstract block and its own heading ("Abstract"); the paper-level context drops the heading when it takes the body */
export const ABSTRACT = { root: '.ltx_abstract', title: '.ltx_title' } as const

/** The candidates for a short heading on one line: the headings of the title unit other than the document's main title (the length is the renderer's call) */
/**
 * May a short heading share its line with the translation (§7.3). The document title **and the document subtitle**
 * are excluded (Codex on #13): both are centred, and squeezed into an inline-block they shrink to their content width
 * and stick to the left — measured 2026-09-06 on the real page of 2609.00246, `(Extended Version)`: originally
 * `display: block`, `text-align: center`, the full 800px column, text centred at x≈720; as inline-block the box was
 * only 176px at l=320, because the parent `<article>` is `text-align: start`. LaTeXML's `.ltx_subtitle` comes from
 * `\subtitle` and occurs in the title area only (both occurrences in the 12 fixtures right after
 * `.ltx_title_document`); a section's run-in heading is `.ltx_title_*` and unaffected
 */
export function isInlineTitleCandidate(el: Element): boolean {
  return classify(el)?.rule === 'title' && !el.matches(`${DOCUMENT_TITLE}, ${DOCUMENT_SUBTITLE}`)
}

export function documentRoot(doc: Document | Element): Element | null {
  // Passed the translation root itself, querySelector would search descendants only and miss it (Codex on #2 / #3)
  if ('matches' in doc && doc.matches(DOCUMENT_ROOT)) return doc
  return doc.querySelector(DOCUMENT_ROOT)
}

/**
 * The text with protect / skip subtrees excluded, untrimmed (§6.2 keeps the thin spaces around formulas).
 * The descend flag is ignored: a footnote body is no visible text to the outer paragraph; descend affects only the extractor's block discovery.
 */
export function visibleText(el: Element): string {
  return textOf(el)
}

/**
 * The class LaTeXML gives “the part of math mode typeset as text” (`\text{}`, `\mathrm{}` and the like): `initMT`,
 * `barrier_N_record(b)` are identifiers to a reader, not words.
 */
const MARKED_AS_MATH = '.ltx_markedasmath'

/**
 * The picture an element lies in (§15.6), or null. What is inside one is the picture's to lay out: a label's node is
 * a box ar5iv sizes and aligns, and a block in there is the figure's text, translated by the reader's setting for
 * figures and not for the body around them
 */
export function pictureOf(el: Element): Element | null {
  return el.closest('svg')
}

export function isFigureText(el: Element): boolean {
  return pictureOf(el) !== null
}

/**
 * What a unit's own text must hold for the unit to be a block, and what is left out of that text first.
 *
 * One letter, anywhere but inside a picture (§15.6) — by the place, not by the rule: a wrapped label's block is the
 * `.ltx_p` it holds, and that is sent on its own just the same (Devin on #277). A label is sent **on its own**, not inside a sentence, and
 * on its own `N`, `q` and `L2` are symbols: it takes two letters running. An identifier set as text in math mode
 * (`initMT`, `softmax`) is a symbol too — a word to an engine, and a formula's name translated in a diagram is worse than none
 * — so what LaTeXML marked as math is left out before the test: of the 507 labels in the measured corpus exactly one
 * is such, `initMT` on 2609.00246 (Codex on #163). Inside a sentence it is translated with the sentence as before
 * (`Block n−1` goes with its symbol): the test decides only whether there is a block
 */
export function blockTest(unit: Element): { holds: RegExp; without?: string } {
  return isFigureText(unit) ? { holds: /\p{L}{2,}/u, without: MARKED_AS_MATH } : { holds: LETTER }
}

function textOf(el: Element, drop?: (el: Element) => boolean): string {
  return collectText(el, node => {
    const kind = classify(node)?.kind
    return kind === 'skip' || kind === 'protect' || !!drop?.(node)
  })
}

// §5.3 numeric cells: a digit required (so that a word starting with E, like ERROR, is not taken for an exponent); symbol-only cells; N/A; blank
const NUMERIC_CELL = /^(?=.*\d)[\s\d.,+\-±×^%()/*eE−–—:;~<>=≤≥∼]+(\s*[a-zA-Zμ°%]{1,4})?$/
const SYMBOL_CELL = /^[✓✗✔✘–—−\-·×*]+$/
const NA_CELL = /^N\/A$/

/** The input should be visibleText's result (formulas excluded); a match is copied as it is, not translated */
export function isNumericCell(text: string): boolean {
  const t = squash(text)
  return t === '' || NUMERIC_CELL.test(t) || SYMBOL_CELL.test(t) || NA_CELL.test(t)
}
