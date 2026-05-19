---
"thumbgate": patch
---

Docs: document the machine-wide vs per-project install scope choice.

ThumbGate has shipped two install scopes since v1.x — `npx thumbgate init` (machine-wide, default, writes to `~/.claude/settings.json`, one shared lesson DB and dashboard across every repo) and `npx thumbgate init --project` (per-repo, writes to `<repo>/.claude/settings.json`, separate lesson DB per repo). Until now, neither scope was documented on any user-facing surface — not the README, not thumbgate.ai, not the guide page, not the CLI help. Users had no way to make an informed choice.

This change adds:

- A dedicated "Install scope: machine-wide vs per-project" section to the README under "Install for Your Agent"
- The same comparison table to `public/guide.html` (rendered on thumbgate.ai/guide.html)
- An expanded `install-mcp` help line in `bin/cli.js` that documents both scopes, the default, and the `--no-hooks` opt-out from the install-mcp + hooks unification PR
- A regression test suite (`tests/install-scope-docs.test.js`, 9 tests) pinning the scope docs in README, guide.html, and CLI help so they cannot silently disappear

No code behavior changes — pure docs + CLI help text + regression test.
