export default defineContentScript({
  matches: ['https://arxiv.org/html/*', 'https://ar5iv.labs.arxiv.org/html/*', 'https://ar5iv.org/html/*'],
  runAt: 'document_idle',
  allFrames: false,
  main() {},
})
