import { choice, type Question, yesno } from '../jev/wire'

export const ROLE: Record<string, string> = {
  background: 'Describes the field, the problem, prior work or motivation; not something this paper did',
  method: 'States what this paper proposes or builds, or how its method works',
  result: 'States a finding, measurement, theorem or comparison obtained in this paper',
  contribution: 'States another contribution of this paper, such as a dataset, an analysis or a release',
}

export const CAVEAT: Record<string, string> = {
  none: 'None of the kinds below: it describes the method, reports a result, gives background or related work, or is a routine detail',
  assumption: 'A premise that the paper’s own method, theory or analysis relies on: an explicit assumption, a hypothesis, a theorem condition',
  condition: 'A condition on when the paper’s method works or when its claim holds: a scope, regime or requirement',
  limitation: 'A weakness, failure, cost or open problem of the paper’s own method or results, including what is left to future work',
  evaluation: 'A caveat about how the paper’s results were obtained that changes how to read them: estimated, best of several runs, a different protocol, development data only, selected examples',
  unsupported: 'A claim the paper makes with hedging or without evidence (expects, may, could, suggests), or that generalises beyond what was tested',
  tradeoff: 'A cost the paper accepts in exchange for a benefit',
}

export const roleQuestion = (sid: string): Question => choice(`What does \`abstract.${sid}\` state?`, ROLE)

export const evidenceQuestion = (sid: string, ids: Record<string, null>): Question =>
  choice(`Which sentence in \`section.sentences\` gives the substance behind \`abstract.${sid}\` — how it is done, or the evidence (numbers, experiment, theorem) for it — rather than restating it?`, ids)

export const existsQuestion = (sid: string): Question => yesno(`Does \`section.sentences\` explain how, or show evidence for, what \`abstract.${sid}\` states?`)

export const caveatQuestion = (sid: string): Question => choice(`What kind of statement is \`passage.${sid}\`, as a statement about this paper’s own work?`, CAVEAT)

const PICK: Record<string, (a: string) => string> = {
  method: a => `Which of these sentences explains most specifically how the method in \`abstract.${a}\` works — its defining mechanism or definition — rather than an overview, a restatement of the claim, or an experimental result?`,
  result: a => `Which of these sentences reports the result claimed in \`abstract.${a}\` — the finding with its numbers, comparison or theorem — rather than a restatement of the claim, a figure caption, or the setup of an experiment?`,
  contribution: a => `Which of these sentences delivers what \`abstract.${a}\` announces — the analysis, finding or artefact itself — rather than a restatement of the claim or a plan?`,
}

export const pickQuestion = (role: string | null, sid: string, ids: Record<string, null>): Question => choice((PICK[role ?? ''] ?? PICK.contribution!)(sid), ids)

export const verifyQuestion = (claim: string, s: string): Question =>
  yesno(`Does \`candidates.${s}\` state the substance of \`abstract.${claim}\` — its mechanism, or its result with numbers or a theorem — rather than only setting up an experiment, restating the claim, or mentioning it?`)

export const qualifiesQuestion = (s: string): Question => yesno(`Does \`candidates.${s}\` limit, qualify or put a condition on something that \`abstract\` claims?`)

export const weakerQuestion = (s: string): Question =>
  yesno(`Does \`candidates.${s}\` say that the paper’s method or results may not hold, hold only under a restriction, rest on an assumption, or were measured in a way that makes them weaker than they look?`)
