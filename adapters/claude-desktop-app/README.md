# ThumbGate Desktop (Claude artifact app)

`thumbgate-desktop.html` is a Claude artifact page that you install as a Mac or
Windows app from the Claude desktop app ("Install as app", beta since
2026-11-24, Claude for Mac/Windows 6.28899.0 or later; see
https://support.claude.com/en/articles/18516354-install-an-artifact-as-an-app).

It shows ThumbGate's blocked and warned counts, recent blocks, recent
thumbs-downs and active prevention rules, and, if allowed:

- a menu bar item (Windows: tray icon) with the blocked count,
- a notification when the blocked count goes up,
- `Alt+Shift+G` to bring the window up.

## What it runs

With the `full-access` permission it runs one read-only command in the project
folder you choose, once a minute:

```
npx --yes thumbgate desktop-snapshot --json
```

On ThumbGate releases without `desktop-snapshot` it falls back to
`thumbgate stats --json` and `thumbgate explore firings|rules|lessons --json`.
It never writes files or captures feedback, and it does not enforce anything:
gates are enforced by the PreToolUse hook whether the app is open or not.

## Publish your own copy

Claude generally allows full access only for an artifact written inside your
own organization, so build it in your own account: ask Claude to publish this
file as an artifact with `capabilities: {"desktop": {}}`, open it in the
Claude desktop app and choose Install as app. The permissions it uses are
declared in the `claude-artifacts-manifest` tag at the top of the file.

## Snapshot schema (`thumbgate.desktop-snapshot/v1`)

```
{ schema, generatedAt, version, feedbackDir,
  totals: { blocked, warned, passed, activeGates, autoPromotedGates, rules, thumbsDown, lessons },
  topGates: [{ id, blocked, warned }],
  recentBlocks: [{ id, reason, context, timestamp }],
  recentThumbsDown: [{ id, context, tags, promoted, timestamp }],
  rules: [{ id, title }],
  plan: { tier: "free" | "pro", upgradeUrl } }
```

Source: `buildDesktopSnapshot` in `scripts/explore-subcommands.js`, tests: `tests/desktop-snapshot.test.js`.
