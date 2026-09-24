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

/** Same page text, same model asked, same engine, same cutting rules: same result (spec §6.3). `model` is the id
 *  requested, not the one that answered, so a change of preset or of custom model never reuses an old result. */
export const cacheKey = (paperId: string, unitsHash: string, model: string): string => `${paperId}|${unitsHash}|${model}|${ENGINE_VERSION}|${RULES_VERSION}`

export class ResultCache {
  private db: Db
  constructor(name = 'jevpaper', private max = 500, private now: () => number = Date.now) {
    this.db = new Db(name)
  }

  async get(key: string): Promise<DigestResult | undefined> {
    const row = await this.db.results.get(key)
    if (!row) return undefined
    await this.db.results.update(key, { usedAt: this.now() })
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
