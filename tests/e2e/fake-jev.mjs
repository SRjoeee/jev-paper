// A local stand-in for Jev's System One endpoint: deterministic answers, request counting, switchable failures.
// It speaks the official wire format (src/background/jev/wire.ts): yes/no questions arrive as `noul` and are
// answered `{ type: 'noul', noul }`; choices are answered `{ type: 'choice', choice, probabilities }`. Any other
// question type is refused with 400, as OpenRouter refuses the `boolean` spelling, and any question key the
// engine (src/background/engine/pipeline.ts) or the key check (validate.ts) does not ask is recorded in
// `state.unknown`, so a change to either shows up here instead of as a silently default answer.
import { createServer } from 'node:http'

/** Every key prefix JevPaper asks: round one (role_, ev_, ex_, cv_), round two (pk_, vf_, ql_, wk_), the key check (ok) */
const KNOWN = /^(?:role|ev|ex|cv|pk|vf|ql|wk)_|^ok$/

/** A small stable hash, so a choice depends on the question key and nothing else */
function hash(text) {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return h >>> 0
}

/** One option at 0.6, the rest sharing 0.4 — which one is picked varies with the key, so claims get different evidence */
function pick(key, ids) {
  const chosen = ids[hash(key) % ids.length]
  const rest = 0.4 / Math.max(1, ids.length - 1)
  return { type: 'choice', choice: chosen, probabilities: Object.fromEntries(ids.map(id => [id, id === chosen ? 0.6 : rest])) }
}

function answerOf(key, q) {
  if (q.type === 'noul') return { type: 'noul', noul: 0.6 }
  const ids = Object.keys(q.criteria)
  // Every abstract sentence a claim (P(background) 0.1), all of them method claims
  if (key.startsWith('role_')) return { type: 'choice', choice: 'method', probabilities: { background: 0.1, method: 0.7, result: 0.1, contribution: 0.1 } }
  // About one sentence in four a limitation, the rest nothing: caveats exist and are not all tied
  if (key.startsWith('cv_')) {
    const limitation = hash(key) % 4 === 0
    return { type: 'choice', choice: limitation ? 'limitation' : 'none', probabilities: Object.fromEntries(ids.map(id => [id, id === 'none' ? (limitation ? 0.2 : 0.9) : id === 'limitation' ? (limitation ? 0.8 : 0.1) : 0])) }
  }
  return pick(key, ids)
}

export async function startFakeJev() {
  const state = { requests: 0, bodies: [], auth: [], unknown: [], mode: 'ok' }
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', chunk => {
      body += chunk
    })
    req.on('end', () => {
      state.requests++
      state.bodies.push(body)
      state.auth.push(req.headers.authorization ?? '')
      if (state.mode === '401') {
        res.writeHead(401)
        return res.end('invalid key')
      }
      const { model, state: paperState, questions } = JSON.parse(body)
      const wrong = Object.entries(questions ?? {}).find(([, q]) => q.type !== 'noul' && q.type !== 'choice' && q.type !== 'score')
      if (!model || paperState === undefined || !questions || wrong) {
        res.writeHead(400, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ error: wrong ? `unknown question type ${wrong[1].type}` : 'model, state and questions are required' }))
      }
      for (const key of Object.keys(questions)) if (!KNOWN.test(key)) state.unknown.push(key)
      const answers = Object.fromEntries(Object.entries(questions).map(([k, q]) => [k, answerOf(k, q)]))
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ answers, usage: { input_tokens: 1 } }))
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return { state, url: `http://127.0.0.1:${server.address().port}/v1/systemone`, close: () => server.close() }
}
