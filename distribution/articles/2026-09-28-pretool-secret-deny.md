---
title: How to stop Claude Code and Cursor from leaking API keys
published: true
tags: security, ai, opensource
canonical_url: https://thumbgate.ai/blog/2026-09-28-pretool-secret-deny
---

A system prompt that says "never leak secrets" does not stop the tool call. The check has to run before the command executes.

## Where the leak happens

Claude Code and Cursor run shell and HTTP tools on your behalf. A command that prints an environment variable, posts a token, or copies a key into a request is already too late once the process starts. The useful control is a PreToolUse hook: inspect the command, then deny it.

## Deny, do not warn-and-continue

ThumbGate treats a detected secret as a deny. The agent stops. It does not rewrite the same command with the secret still inside it. A warning on an internal policy, such as spend, is a warning. That warning is not permission to send a credential on the next call.

The same repository can also record a lesson. If that lesson already failed once, the repeat is a deny too.

## What you run

```bash
npx thumbgate init
npx thumbgate gate-check
```

Pass the tool name and the tool input to `gate-check`. A deny result ends the turn. Hosted Pro, which keeps shared lesson history and the dashboard, is separate from the public package.

- Dev.to readers: [ThumbGate Pro](https://thumbgate.ai/pro?utm_source=devto&utm_medium=article&utm_campaign=pretool-secrets)
- Coder Legion readers: [ThumbGate Pro](https://thumbgate.ai/pro?utm_source=coderlegion&utm_medium=community&utm_campaign=pretool-secrets)

Checkout logging for the same campaign also accepts `https://thumbgate.ai/go/pro` with the same `utm_source`, `utm_medium`, and `utm_campaign`.
