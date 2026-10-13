# browser-sanity-host

The local **native-messaging host** for the [Browser Sanity](https://github.com/Greenysmac/browser-sanity) Chrome and Edge extension. The extension is the front end; this is the small Node program it talks to. It runs your chosen AI backend (an AI command-line tool, or an OpenAI-style API) and keeps the index of your groups. Nothing is sent to any server the developer runs.

A native host can't ship inside an extension package, so it's installed once, separately, from the project folder.

## Install

Requires **Node.js 20+**. From the Browser Sanity folder:

```sh
npm run install-host
```

This copies the host into a stable per-user location (`~/.browser-sanity`, or `%LOCALAPPDATA%\BrowserSanity` on Windows) and registers it for Chrome and Edge using the extension's pinned ID.

```sh
node native-host/cli.js install chrome   # specific browser(s)
node native-host/cli.js repair           # re-register a broken install
node native-host/cli.js uninstall        # remove
```

This package isn't published to npm. A package with a similar name there isn't Browser Sanity's.

## Security

The host resolves the command, arguments, environment and any API key on your machine. An extension message can only pick *which* known backend runs, never *what* runs. See [`docs/security-model.md`](../docs/security-model.md).

## License

MIT. Copyright (c) 2026 Lusk Technologies (the original Browser Organizer host) and (c) 2026 Jeff Greenberg (Browser Sanity changes).
