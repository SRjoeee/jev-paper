import Dexie, { type Table } from 'dexie'
import { RULES_VERSION } from '@/core/rules/latexml'
import type { DigestResult } from '@/shared/result'
import { ENGINE_VERSION } from './engine/version'

interface Row {
  key: string
  result: DigestResult
  createdAt: number
  usedAt: number
}

class Db extends Dexie {
  results!: Table<Row, string>
  constructor(name: string) {
    super(name)
    this.version(1).stores({ results: 'key, usedAt' })
  }
}

/** A paper id without its version (`1706.03762v7` → `1706.03762`): two versions whose text is the same share a
 *  result, and the units hash still tells apart two whose text differs */
export const unversioned = (paperId: string): string => paperId.replace(/(\d)v\d+$/, '$1')

/** One paper's text: what a paper page waits on, whichever model answers it (presence.ts leaves runs by it) */
export const runOf = (paperId: string, unitsHash: string): string => `${unversioned(paperId)}|${unitsHash}`

/** Same page text, same model asked, same engine, same cutting rules: same result (spec §6.3). `model` is the id
 *  requested, not the one that answered, so a change of preset or of custom model never reuses an old result. */
export const cacheKey = (paperId: string, unitsHash: string, model: string): string => `${runOf(paperId, unitsHash)}|${model}|${ENGINE_VERSION}|${RULES_VERSION}`

export class ResultCache {
  private db: Db
  constructor(name = 'jevpaper', private max = 500, private now: () => number = Date.now) {
    this.db = new Db(name)
  }

  /** `touch: false` reads without noting the use, for an incognito tab */
  async get(key: string, { touch = true }: { touch?: boolean } = {}): Promise<DigestResult | undefined> {
    const row = await this.db.results.get(key)
    if (!row) return undefined
    // Fire and forget: a read never fails because the disk is too full to note when it happened
    if (touch) this.db.results.update(key, { usedAt: this.now() }).catch(() => {})
    return row.result
  }

  async put(key: string, result: DigestResult): Promise<void> {
    const t = this.now()
    await this.db.results.put({ key, result, createdAt: t, usedAt: t })
    const n = await this.db.results.count()
    if (n > this.max) await this.db.results.bulkDelete(await this.db.results.orderBy('usedAt').limit(n - this.max).primaryKeys())
  }

  close(): void {
    this.db.close()
  }
}
