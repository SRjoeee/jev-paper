# JevPaper

A Chrome extension for reading arXiv papers. Open a paper's HTML page and JevPaper marks, right on the page:

- each claim in the abstract;
- the sentence in the body that delivers it (click a claim to jump there, click the sentence to jump back);
- the assumptions and limitations a careful reader should know.

A small button in the corner chooses how much is marked, in three levels: claims and their evidence; plus
assumptions and limitations; plus more candidates. Changing the level only repaints the page and asks for nothing
new.

The sentences are judged by [Jev](https://typesafe.ai), TypeSafe's System One model, through your own key. JevPaper
works on arXiv's HTML full text (`arxiv.org/html/…`) and on ar5iv (`ar5iv.labs.arxiv.org/html/…`,
`ar5iv.org/html/…`). It does nothing on abstract pages or PDFs. The interface is in Chinese.

## Your key

JevPaper has no server and no account. You bring your own key for one of these:

- **OpenRouter** (the default), which serves Jev;
- **TypeSafe**, Jev's own API;
- **a custom endpoint** that speaks Jev's System One protocol, with a model id of your choice.

Click the toolbar icon, pick the service, paste the key and press 「开始使用」. JevPaper checks the key with one
small request before it saves it. Through OpenRouter a paper cost $0.006–0.015 and took about one to three
seconds when measured in September 2026. Each paper is computed once for each model and then answered from the
cache.

## Privacy

- **What leaves your computer.** The paper's title and its sentences, as cut from the page you opened, go to
  the service you chose (OpenRouter, TypeSafe or your own endpoint), sent with your key. Nothing goes anywhere
  else. JevPaper has no server of its own and no analytics.
- **What stays on it.** The key is kept in `chrome.storage.local` on this device and is never synced. The marks
  for each paper are cached in the extension's IndexedDB, up to 500 papers, so reopening a paper costs nothing.
  Papers opened in incognito tabs are not cached: JevPaper writes nothing about them.
- **Where the key can be read.** The extension's own code reads the key only in its service worker and its
  popup. The script that runs on arXiv pages never reads it, and a test keeps that code from importing it. Chrome
  itself does not enforce this: it lets any content script of the extension read `chrome.storage.local`. The
  isolation holds because of how the code is written, not because the browser stops it.

## Permissions

- `storage`: the key, the level you chose, and the cache.
- Host access to `openrouter.ai` and `api.typesafe.ai`, the two preset services. A custom endpoint's origin is
  requested when you save it.
- A content script on arXiv and ar5iv HTML pages, top frame only.

## Build and load

You need Node.js 22 or later, [pnpm](https://pnpm.io) 10 and Chrome 128 or later.

    pnpm i
    pnpm build

Then open `chrome://extensions`, turn on developer mode, choose **Load unpacked** and pick `.output/chrome-mv3`.
`pnpm dev` starts Chrome with the extension loaded and reloads it as you edit. `pnpm zip` packs a build for
distribution.

## Tests

    pnpm test        # unit tests (Vitest)
    pnpm e2e         # end-to-end tests in Chromium (Playwright)

- `pnpm test` downloads a few arXiv pages the first time it runs. They are test fixtures that arXiv may
  distribute but this repository may not; each is checked against a recorded SHA-256 and kept, git-ignored, in
  `tests/fixtures/`. `pnpm fixtures:fetch` downloads them on its own.
- `pnpm e2e` needs those fixtures, and Playwright's Chromium (`pnpm exec playwright install chromium`). It
  builds a test copy of the extension and runs it against saved arXiv pages and a local stand-in for Jev. It
  needs no key and costs nothing. It does load arXiv's own style sheets from the network.
- `pnpm typecheck` and `pnpm lint` check types and lint.
- `pnpm notices` regenerates `public/licenses/THIRD_PARTY.txt` after a dependency changes.

## Licence

JevPaper is free software under the GNU General Public License, version 3 ([LICENSE](LICENSE)).

Parts of it are adapted from Read arXiv, which is also under GPL-3.0. Each such file names its source in its first
line. The highlighter icon is [Lucide](https://lucide.dev)'s, under the ISC licence
([public/licenses/lucide.txt](public/licenses/lucide.txt)). The libraries bundled into the extension, including React,
Dexie, zod and WXT's runtime, keep their own licences. Their full texts are in
[public/licenses/THIRD_PARTY.txt](public/licenses/THIRD_PARTY.txt).

## Credits

- Jev and its System One protocol are by [TypeSafe](https://typesafe.ai). OpenRouter serves it.
- Sentence extraction, formula handling and the band painting build on Read arXiv.
- Built with [WXT](https://wxt.dev), React, Dexie and zod. Tested with Vitest, happy-dom and Playwright.
