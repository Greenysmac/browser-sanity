# browser-sanity-host

The local **native-messaging host** for the [Browser Sanity](https://lusk.dev/browser-sanity)
Chrome/Edge extension. The extension is only a front-end; this package is the small Node
program it talks to, which runs your chosen AI backend (a local AI CLI, or an
OpenAI-compatible API) and returns organization suggestions. **Nothing is sent to any server
the developer runs.**

A native host cannot ship inside a Web Store package, so it's installed once, separately.

## Install

Requires **Node.js 20+**. From any directory:

```sh
npx browser-sanity-host
```

This copies the host into a stable per-user location (`~/.browser-sanity`, or
`%LOCALAPPDATA%\BrowserSanity` on Windows) and registers it for Chrome and Edge using the
extension's pinned ID — you don't need to be inside any project folder, and the download can
be deleted afterward.

```sh
npx browser-sanity-host install chrome   # specific browser(s)
npx browser-sanity-host repair           # re-register a broken install
npx browser-sanity-host uninstall        # remove
```

Prefer a double-click, no-Node installer? Download the per-OS installer from the
[releases page](https://github.com/Greenysmac/browser-sanity/releases).

## Security

The host resolves the command, arguments, environment, and any API key **on your machine** —
an extension message can only pick *which* known backend runs, never *what* runs. See
[`docs/security-model.md`](https://github.com/Greenysmac/browser-sanity/blob/main/docs/security-model.md).

## License

MIT © Lusk Technologies
