# Fixtures

- `arxiv/*.html` committed here are Read arXiv's redistributable set, copied at 3f3c91f8.
- `remote.json` lists pages arXiv may distribute and this repository may not. `pnpm fixtures:fetch` (and the first
  `pnpm test`) downloads each from its pinned version and accepts only the recorded SHA-256. They are git-ignored.
- `jev/1706.03762v7.html` (Attention Is All You Need, the 「试一试」 paper) and `jev/2607.24653v2.html` (Kimi K3,
  whose appendix author list is the list-like unit the engine must not mark) are JevPaper's own remote fixtures.
