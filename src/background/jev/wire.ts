// Question and answer shapes. Inside JevPaper a yes/no question is spelled `boolean` — the experiment's spelling,
// kept so the engine's question objects match it byte for byte — and translated to the official `noul` on the wire.
export type Question =
  | { type: 'boolean'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> }
  | { type: 'score'; instructions: string; criteria: string[] }
export type Questions = Record<string, Question>

export type Answer =
  | { type: 'boolean'; probability: number }
  | { type: 'choice'; choice: string; probabilities: Record<string, number>; confidence?: number }
  | { type: 'score'; score: number }
export type Answers = Record<string, Answer>

export const yesno = (instructions: string): Question => ({ type: 'boolean', instructions })
export const choice = (instructions: string, criteria: Record<string, string | null>): Question => ({ type: 'choice', instructions, criteria })

export function toWire(questions: Questions): Record<string, unknown> {
  return Object.fromEntries(Object.entries(questions).map(([k, q]) => [k, q.type === 'boolean' ? { ...q, type: 'noul' } : q]))
}

export function fromWire(answers: Record<string, unknown>): Answers {
  return Object.fromEntries(
    Object.entries(answers).map(([k, a]) => {
      const x = a as { type?: string; noul?: number }
      return [k, x.type === 'noul' ? { type: 'boolean', probability: Number(x.noul) } : (a as Answer)]
    }),
  )
}
