# Security Policy

## Reporting a vulnerability

**Please do not report security vulnerabilities through public issues, pull requests, or
discussions.**

Report privately using GitHub's built-in private vulnerability reporting:

1. Open the repository's **[Security tab](https://github.com/Greenysmac/browser-sanity/security)**.
2. Click **"Report a vulnerability"** (or use
   [this link](https://github.com/Greenysmac/browser-sanity/security/advisories/new)) to open a
   private security advisory.
3. Include the affected component (extension, native host, or installer), the version, and clear
   steps to reproduce (proof-of-concept if you have one).

We aim to **acknowledge reports within 3 business days** and to share a remediation plan after
triage. Please give us a reasonable opportunity to fix the issue before any public disclosure;
we're happy to credit you in the advisory once it's resolved.

## Scope

In scope:

- The browser extension (`extension/`)
- The native messaging host (`native-host/`)
- The installers (`installer/`)

We're especially interested in: the native-messaging message surface (an extension message may
carry only an adapter name, `timeoutMs`, and — for the OpenAI adapter — `{apiKey, baseUrl,
model}`), command/argument/environment/credential injection into the host, and handling of the
encrypted-at-rest API key.

Out of scope: vulnerabilities in the third-party AI CLIs or API providers you configure, and
issues that require an already-compromised local machine or account.

## Supported versions

Security fixes are made against the latest published release; please reproduce on the latest
version before reporting.

## Security model

For how the product is designed to be secure (how the host constrains commands, credentials,
and untrusted input), see [`docs/security-model.md`](../docs/security-model.md).
