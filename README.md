# JevPaper

A Chrome extension: open an arXiv paper's HTML page and JevPaper marks, right on the page, each abstract claim, the
body sentence that delivers it, and the assumptions and limitations a careful reader must know. It asks Jev
(TypeSafe's System One model) through your own OpenRouter or TypeSafe key.

    pnpm install
    pnpm dev            # Chrome with the extension loaded
    pnpm test           # unit tests (downloads the remote fixtures once)
    pnpm e2e            # end-to-end tests against a built extension, no key needed

Design: docs/superpowers/specs/2026-09-24-jevpaper-design.md. Licence: GPL-3.0; parts are copied from Read arXiv
(same owner, GPL-3.0), each such file says so in its first line.
