# Thumbs feedback everywhere you use Claude

A thumbs-up or thumbs-down only changes what an agent does if ThumbGate records
it. In a local Claude Code session the `UserPromptSubmit` hook does that for you.
Everywhere else (claude.ai chats, Claude Desktop, Claude projects and their
threads, cloud Claude Code sessions) there is no hook, so the model has to call a
ThumbGate tool. This page is the one setup every surface can use.

## Which path records the feedback

| Where you work | How the thumbs gets recorded | Where it is enforced |
| --- | --- | --- |
| Claude Code on your machine, ThumbGate installed | `UserPromptSubmit` hook, automatic | Local PreToolUse gates |
| Claude Desktop, or a Claude project thread linked to your computer | The local ThumbGate MCP server (`thumbgate` under the device's tools), `capture_feedback` | Local store directly, same gates |
| claude.ai chats, projects without a linked computer, cloud sessions | Hosted connector `https://thumbgate.ai/mcp`, `capture_feedback` | Hosted store, then `thumbgate sync-hosted` pulls it into the local store |

## Hosted connector

- URL: `https://thumbgate.ai/mcp` (Streamable HTTP, OAuth 2.1 with PKCE,
  dynamic client registration, refresh tokens).
- Add it in claude.ai under Settings, Connectors, Add custom connector. It then
  shows up in claude.ai chats, Claude Desktop and Claude projects for the same
  account.
- On `initialize` the server sends instructions telling the model to call
  `capture_feedback` whenever you give feedback, to call `gate_check` before
  actions that are hard to undo, and to never say feedback was recorded unless
  the tool returned `accepted: true`.
- Sign-in survives a server redeploy: registered clients and tokens are kept on
  the data volume, as SHA-256 digests only. Rotating the ThumbGate key revokes
  every connector session bound to the old key.
- Today the consent screen accepts the operator's ThumbGate key, so it is a
  single-owner connector. Per-user hosted stores are a separate follow-up.

## Getting hosted feedback into local gates

```bash
npx thumbgate sync-hosted          # pull new hosted thumbs into this project's store
npx thumbgate sync-hosted --dry-run --json
```

`session-start` runs the same sync in the background whenever an operator key
is configured (`THUMBGATE_OPERATOR_KEY` or `operatorKey` in
`~/.config/thumbgate/operator.json`). Set `THUMBGATE_HOSTED_SYNC=0` to turn it
off. Each hosted event is imported once (state in
`hosted-feedback-sync-state.json`) through the normal `captureFeedback`
pipeline, tagged `hosted-connector`, so it becomes the same lessons and rules as
feedback typed locally.

## Instruction snippet for Claude projects

Paste this into a project's instructions or project memory so its coordinator
and threads record feedback instead of only writing it into memory:

```text
ThumbGate feedback rule. When the person gives feedback on your work (a thumbs-up
or thumbs-down emoji, "thumbs down", "+1", "-1", "that was wrong", "good job"),
record it in the same turn, before you reply:
1. If a ThumbGate tool from the person's computer is available
   (thumbgate capture_feedback through the device tools), use it.
2. Otherwise use the hosted ThumbGate connector's capture_feedback.
Pass signal "down" or "up", context = what you just did, and one sentence each
for whatWentWrong and whatToChange (down) or whatWorked (up), naming the exact
action. Only say it was recorded if the tool returned accepted: true. If neither
tool is available, say plainly that the feedback was not recorded in ThumbGate.
Before an action that is hard to undo (send, post, deploy, delete, merge, pay),
call gate_check and follow a deny or warn result.
```

## Verify

```bash
curl -s -X POST https://thumbgate.ai/mcp -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'
curl -s https://thumbgate.ai/.well-known/oauth-authorization-server
```

The first returns `instructions` that mention `capture_feedback`; the second
lists `refresh_token` in `grant_types_supported`. `tests/hosted-feedback-everywhere.test.js`
runs the whole path: sign in, redeploy, refresh, capture a thumbs-down over MCP,
then sync it into a separate local store.
