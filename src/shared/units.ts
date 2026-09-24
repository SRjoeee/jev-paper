export type UnitKind = 'abstract' | 'body' | 'caption' | 'footnote'

/** One sentence of the paper, in the shape the engine's questions were written against. */
export interface Unit {
  /** `s001`, `s002`, … in document order */
  sid: string
  kind: UnitKind
  /** The top-level section element's id (`S3`, `A1`), `abstract`, or `front` before the first section */
  sec: string
  secTitle: string
  /** The paragraph the sentence belongs to; a window of sentences never splits one */
  pid: string
  /** Plain text: inline maths as `$tex$` (or `[math]` when long), display maths as `[equation]` */
  text: string
  /** A list of names or terms (an author list), not prose: never a candidate, never marked */
  list?: true
}

export interface Paper {
  title: string
  units: Unit[]
}
