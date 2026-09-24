import type { ErrorCode } from './errors'
import { type Lang, uiLang } from './lang'
import type { CaveatType, Role } from './result'

// Every string the reader sees, in Chinese and English. One term for the product's output: 标记 / mark.
const LEDE = '打开 arXiv 论文，重点自动标出来。'

const ZH = {
  brand: 'JevPaper',
  lede: LEDE,
  /** The manifest's description (scripts/locales.ts), shown on chrome://extensions */
  description: LEDE,
  layers: { 1: '主张与证据', 2: '假设与局限', 3: '更多候选' } as const,
  layersLabel: '标记层次',
  button: 'JevPaper：选择标记多少',
  bubble: '点这里，选择标记多少',
  status: {
    /** The page's own announcement when a digest lands (spec §13) */
    marked: (n: number) => `已标出 ${n} 处`,
    /** The popup's status line for the tab in front (spec §7) */
    pageMarked: (n: number) => `本页已标出 ${n} 处`,
    none: '这篇论文没有找到可标记的内容',
    computing: '正在标记…',
    notPaper: '打开任意 arXiv 论文的 HTML 版即可使用',
    /** The popup's status line for a page that failed: nothing there to click, unlike the button's `pageError` */
    error: {
      'no-key': '还没有设置 key',
      'invalid-key': 'key 无效，请更换',
      credit: 'key 的额度用完了，请充值或更换',
      busy: '服务繁忙，请稍后再试',
      offline: '连不上服务，请检查网络',
      'not-jev': '这个地址没有返回 Jev 的结果，请检查设置',
      aborted: '服务繁忙，请稍后再试',
    } satisfies Record<ErrorCode, string>,
  },
  role: { method: '方法', result: '结果', contribution: '贡献', background: '背景' } satisfies Record<Role, string>,
  roleFallback: '主张',
  caveat: { assumption: '假设', condition: '适用条件', limitation: '局限', evaluation: '评测保留', unsupported: '未证实', tradeoff: '代价' } satisfies Record<CaveatType, string>,
  caveatFallback: '假设与局限',
  tip: {
    claim: (no: number, role: string) => `摘要第 ${no} 条 · ${role} · 点击看证据`,
    evidence: (nos: readonly number[], candidate: boolean) => `兑现摘要第 ${nos.join('、')} 条${candidate ? '（候选）' : ''} · 点击回到摘要`,
  },
  anchor: {
    claim: (no: number) => `摘要第 ${no} 条：跳到正文证据`,
    evidence: (no: number) => `证据：回到摘要第 ${no} 条`,
  },
  pageError: {
    'no-key': '还没有设置 key。点这里去设置',
    'invalid-key': 'key 无效。点这里去更换',
    credit: 'key 的额度用完了。点这里去更换',
    busy: '服务繁忙。点这里重试',
    offline: '连不上服务。检查网络后点这里重试',
    'not-jev': '这个地址没有返回 Jev 的结果。点这里去检查设置',
    aborted: '服务繁忙。点这里重试',
  } satisfies Record<ErrorCode, string>,
  setup: {
    providerLabel: '服务',
    providers: { openrouter: 'OpenRouter', typesafe: 'TypeSafe', custom: '自定义' },
    keyLabel: 'API key',
    keyPlaceholder: { openrouter: 'sk-or-…', typesafe: '', custom: '' },
    getKey: { openrouter: '在 OpenRouter 获取 key ↗', typesafe: '在 TypeSafe 获取 key ↗' },
    localOnly: '只保存在本机',
    endpointLabel: '地址',
    endpointPlaceholder: 'https://example.com/v1/systemone',
    modelLabel: '模型',
    /** An example model id, the same in every language */
    modelPlaceholder: 'jev-latest',
    submit: '开始使用',
    errors: {
      empty: '请粘贴 API key',
      'invalid-key': '这把 key 无效。请检查是否完整复制，或重新生成一把',
      credit: '这把 key 的额度用完了。请充值，或换一把 key',
      offline: '连不上服务。请检查网络后再试',
      'not-jev': '这个地址没有返回 Jev 的结果。请检查地址和模型名',
      busy: '服务繁忙。请稍后再试',
      permission: '需要允许访问这个地址才能使用',
      endpoint: '请填写以 https:// 开头的地址（本机地址可用 http://）和模型名',
    },
  },
  ready: { change: '更改', guideAgain: '查看引导' },
  guide: {
    title: 'JevPaper 已就绪',
    lede: '打开 arXiv 论文的 HTML 版，JevPaper 会把重点直接标在原文上。',
    colors: '三种颜色',
    colorNotes: {
      1: '摘要里的主张，和正文里兑现它的那一句',
      2: '读者必须知道的前提和局限',
      3: '可能兑现主张的其他句子',
    } as const,
    tipsTitle: '怎么用',
    tips: ['点摘要里的主张，跳到正文里兑现它的那一句；再点那一句，回到摘要。', '点右下角的按钮，选择标记多少。'],
    cta: '试一试：Attention Is All You Need',
  },
} as const

/** The Chinese copy with its literal strings widened: the shape every language fills, key for key */
type Widen<T> = T extends string ? string : T extends (...args: infer A) => infer R ? (...args: A) => Widen<R> : { readonly [K in keyof T]: Widen<T[K]> }
export type Copy = Widen<typeof ZH>

// English follows .claude/skills/better-writing: sentence case, verbs first on buttons, errors that say how to fix.
// A message that is a full sentence, or has more than one clause, ends with a period; a fragment does not.
const EN_LEDE = 'Open an arXiv paper and its key sentences are marked for you.'
const EN_CLAIM = 'Claim'
const marks = (n: number) => (n === 1 ? '1 mark' : `${n} marks`)

const EN = {
  brand: 'JevPaper',
  lede: EN_LEDE,
  description: EN_LEDE,
  layers: { 1: 'Claims & evidence', 2: 'Assumptions & limits', 3: 'More candidates' },
  layersLabel: 'What to mark',
  button: 'JevPaper: choose what to mark',
  bubble: 'Click here to choose what to mark',
  status: {
    marked: (n: number) => `${marks(n)} on this page`,
    pageMarked: (n: number) => `${marks(n)} on this page`,
    none: 'Nothing to mark in this paper',
    computing: 'Marking…',
    notPaper: 'Open any arXiv paper’s HTML page to start.',
    error: {
      'no-key': 'No API key yet.',
      'invalid-key': 'This key is invalid. Change it below.',
      credit: 'This key is out of credit. Add credit, or change it below.',
      busy: 'The service is busy. Try again soon.',
      offline: 'Can’t reach the service. Check your network.',
      'not-jev': 'This endpoint didn’t return a Jev result. Check the settings.',
      aborted: 'The service is busy. Try again soon.',
    },
  },
  role: { method: 'Method', result: 'Result', contribution: 'Contribution', background: 'Background' },
  roleFallback: EN_CLAIM,
  caveat: { assumption: 'Assumption', condition: 'Condition', limitation: 'Limitation', evaluation: 'Evaluation caveat', unsupported: 'Unsupported', tradeoff: 'Trade-off' },
  caveatFallback: 'Assumption or limit',
  tip: {
    // A claim without a confident role is labelled with the fallback, which here is the tip's own first word
    claim: (no: number, role: string) => (role === EN_CLAIM ? `Claim ${no} · Click to see its evidence` : `Claim ${no} · ${role} · Click to see its evidence`),
    evidence: (nos: readonly number[], candidate: boolean) => `Delivers ${nos.length === 1 ? 'claim' : 'claims'} ${nos.join(', ')}${candidate ? ' (candidate)' : ''} · Click to go back`,
  },
  anchor: {
    claim: (no: number) => `Claim ${no}: jump to its evidence`,
    evidence: (no: number) => `Evidence: go back to claim ${no}`,
  },
  pageError: {
    'no-key': 'No API key yet. Click here to add one.',
    'invalid-key': 'The API key is invalid. Click here to change it.',
    credit: 'The API key is out of credit. Click here to change it.',
    busy: 'The service is busy. Click here to try again.',
    offline: 'Can’t reach the service. Check your network, then click here to try again.',
    'not-jev': 'This endpoint didn’t return a Jev result. Click here to check the settings.',
    aborted: 'The service is busy. Click here to try again.',
  },
  setup: {
    providerLabel: 'Service',
    providers: { openrouter: 'OpenRouter', typesafe: 'TypeSafe', custom: 'Custom' },
    keyLabel: 'API key',
    keyPlaceholder: { openrouter: 'sk-or-…', typesafe: '', custom: '' },
    getKey: { openrouter: 'Get a key from OpenRouter ↗', typesafe: 'Get a key from TypeSafe ↗' },
    localOnly: 'Stays on this device',
    endpointLabel: 'Endpoint',
    endpointPlaceholder: 'https://example.com/v1/systemone',
    modelLabel: 'Model',
    modelPlaceholder: 'jev-latest',
    submit: 'Get started',
    errors: {
      empty: 'Paste your API key.',
      'invalid-key': 'This key is invalid. Check that you copied all of it, or create a new one.',
      credit: 'This key is out of credit. Add credit, or use another key.',
      offline: 'Can’t reach the service. Check your network and try again.',
      'not-jev': 'This endpoint didn’t return a Jev result. Check the endpoint and model name.',
      busy: 'The service is busy. Try again in a moment.',
      permission: 'Allow access to this endpoint to use it.',
      endpoint: 'Enter an endpoint starting with https:// (http:// for localhost) and a model name.',
    },
  },
  ready: { change: 'Change', guideAgain: 'Show guide' },
  guide: {
    title: 'JevPaper is ready',
    lede: 'Open any arXiv paper’s HTML page, and JevPaper marks its key sentences right in the text.',
    colors: 'Three colours',
    colorNotes: {
      1: 'A claim in the abstract, and the sentence in the body that delivers it',
      2: 'Assumptions and limits you need to know',
      3: 'Other sentences that may deliver a claim',
    },
    tipsTitle: 'How to use it',
    tips: ['Click a claim in the abstract to jump to the sentence that delivers it. Click that sentence to go back.', 'Click the button at the bottom right to choose what to mark.'],
    cta: 'Try it: Attention Is All You Need',
  },
} satisfies Copy

const BY_LANG: Record<Lang, Copy> = { zh: ZH, en: EN }

/** The copy of one language; tests and the build's locale files ask for a language by name */
export function copyFor(lang: Lang): Copy {
  return BY_LANG[lang]
}

/** The interface language of this page, content script or service worker (src/shared/lang.ts), read once */
export const LANG: Lang = uiLang()
export const COPY: Copy = copyFor(LANG)
