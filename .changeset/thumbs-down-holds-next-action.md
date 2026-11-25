---
"thumbgate": minor
---

A thumbs-down now blocks before the next action, not after it, in Claude Code and Cursor.

- One thumbs-down from a person holds the action that drew it. After a chat or colleague post, every new post is refused until the last bubble is edited in place; after a shell command, the same command is refused until the person says "go ahead" or gives a thumbs-up. Holds expire after 24 hours. Off with `THUMBGATE_SEND_GATE=0`.
- Chat posts and edits are refused when they contain a raw URL or "I do not know", and a second new bubble in the same chat within 15 minutes is refused (`THUMBGATE_CHAT_BUBBLE_WINDOW_MIN`).
- One thumbs-down on an unchecked status claim (sign-in refused, host down, ticket blocked, deployed, fixed) writes a rule for that whole kind of claim. It used to take two thumbs-downs worded the same way. A learned claim also needs the check's output in the reply, not only a tool call.
- The status-claim gate now runs by default inside `thumbgate claim-stop-check`, ahead of the completion-claim gate. Off with `THUMBGATE_CLAIM_GATE=0`.
- The Cursor plugin adds `beforeMCPExecution` (so chat sends through MCP tools are gated), `afterShellExecution`/`afterMCPExecution`/`afterAgentResponse` recording, and a `stop` hook that sends one follow-up when a reply makes an unchecked status claim. Cursor hooks now resolve the project from `workspace_roots`, not the plugin directory.
- `aws s3 rm` and `kubectl delete` are denied in every form, not only with `--recursive` or for namespaces.
