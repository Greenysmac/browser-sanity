# Contributing to Browser Sanity

Thanks for your interest! Browser Sanity is a Chrome/Edge extension (`extension/`) plus a
small Node native-messaging host (`native-host/`) that runs your chosen AI backend locally.

## Getting started

- Node.js 20+.
- `npm ci` — install dev dependencies.
- `npm test` — unit suite (`node --test`, no browser needed).
- `npm run lint` — ESLint.
- `npm run e2e` — Playwright end-to-end (loads the real extension; needs `xvfb` on Linux). See
  the **End-to-end tests** section in the [README](../README.md).
- To try it in a real browser, follow [docs/TESTING.md](../docs/TESTING.md).

## Making changes

- Branch off `main` and open a pull request; keep PRs focused.
- Keep the unit and lint suites green, and add tests for new behavior.
- Match the surrounding conventions:
  - The extension writes DOM via `textContent` only (never `innerHTML` with tab/bookmark data).
  - The host resolves the command, arguments, environment, and any credentials **host-side** —
    an extension message can only pick *which* known backend runs, never *what* runs. See
    [docs/security-model.md](../docs/security-model.md).
  - Keep the native host dependency-free.
- Update `CHANGELOG.md` for any user-facing change.

## Reporting bugs and requesting features

Use the issue templates (Bug report / Feature request). For **security** issues, do **not** open
a public issue — follow the [Security Policy](SECURITY.md).

## Code of Conduct

By participating, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).
