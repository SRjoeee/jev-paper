// Question and answer shapes. Inside JevPaper a yes/no question is spelled `boolean` — the experiment's spelling,
// kept so the engine's question objects match it byte for byte (the parity test hashes each question as the
// experiment recorded it) — and translated to the official `noul` on the wire, both ways.
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

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const isNumber = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)

/** One answer read off the wire and checked against its question; null when it is not the answer asked for */
function read(question: Question, a: unknown): Answer | null {
  if (!isObject(a)) return null
  switch (question.type) {
    case 'boolean':
      return a.type === 'noul' && isNumber(a.noul) ? { type: 'boolean', probability: a.noul } : null
    case 'choice': {
      const { choice: picked, probabilities, confidence } = a
      if (a.type !== 'choice' || typeof picked !== 'string' || !Object.hasOwn(question.criteria, picked)) return null
      if (!isObject(probabilities) || !Object.values(probabilities).every(isNumber)) return null
      return { type: 'choice', choice: picked, probabilities: probabilities as Record<string, number>, ...(isNumber(confidence) ? { confidence } : {}) }
    }
    case 'score':
      return a.type === 'score' && isNumber(a.score) ? { type: 'score', score: a.score } : null
  }
}

/**
 * Reads the answers off the wire, checked against the questions asked: every question answered, with its asked
 * type — a yes/no with a finite probability, a choice with one of its criteria and a probabilities object of
 * finite numbers, a score with a finite score. Throws on the first answer that is not; answers to questions not
 * asked are dropped.
 */
export function fromWire(questions: Questions, answers: Record<string, unknown>): Answers {
  const out: Answers = {}
  for (const [id, question] of Object.entries(questions)) {
    const answer = read(question, answers[id])
    if (!answer) throw new Error(`${id}: ${id in answers ? `not a ${question.type === 'boolean' ? 'noul' : question.type} answer` : 'no answer'}`)
    out[id] = answer
  }
  return out
}
