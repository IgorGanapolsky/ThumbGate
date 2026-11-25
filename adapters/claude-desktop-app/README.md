# ThumbGate Desktop (Claude artifact app)

`thumbgate-desktop.html` is a Claude artifact you install as a Mac or Windows app
from the Claude desktop app ("Install as app", beta since 2026-11-24,
https://support.claude.com/en/articles/18516354-install-an-artifact-as-an-app).
It shows blocked and warned counts, recent blocks, thumbs-downs and rules, and,
if allowed, a menu bar count, an alert per new block and `Alt+Shift+G`.

With `full-access` it runs one read-only command once a minute in the project
folder you pick: `npx --yes thumbgate desktop-snapshot --json` (older releases:
`stats --json` and `explore rules|lessons --json`, no block list). It writes nothing and enforces nothing.

Full access is generally allowed only for apps written inside your own
organization, so ask Claude to publish your own copy of this file as an artifact
with `capabilities: {"desktop": {}}`, then choose Install as app.

Snapshot schema `thumbgate.desktop-snapshot/v1`: see `buildDesktopSnapshot` in
`scripts/explore-subcommands.js` and `tests/desktop-snapshot.test.js`.
