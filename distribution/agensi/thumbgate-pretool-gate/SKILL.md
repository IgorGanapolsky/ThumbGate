---
name: thumbgate-pretool-gate
description: "Hard-blocks secret exfiltration and repeats of a ranked lesson before a tool call, instead of warning and continuing. Use when the user asks to gate an agent, block a secret, stop a repeat mistake, capture thumbs-down feedback, check gate stats, or install ThumbGate."
external_urls:
  - https://thumbgate.ai
  - https://www.npmjs.com/package/thumbgate
  - https://github.com/IgorGanapolsky/ThumbGate
---

# ThumbGate pre-tool gate

ThumbGate checks a tool call before it runs. Ranked lessons become prevention rules. A detected secret is a deny. A warning is not permission to continue a secret leak.

The public package is `thumbgate` at version 1.37.3. Hosted Pro (shared lesson history, dashboard, proof) is a separate product at https://thumbgate.ai and is not included in this file.

## Install

Run this in the project the agent is editing:

```bash
npx thumbgate@1.37.3 init
```

That scaffolds local gate state and the MCP config. It talks only to the npm registry and, if the user asks for a trial note, to thumbgate.ai. Do not add another installer, a pipe into a shell, or a host that is not in `external_urls`.

## Before the tool call

1. Read the command, the URL, and the file path. If any of them would print, post, upload, or copy a secret, deny the call. Do not paste the secret into a replacement command.
2. If this repository already has a ranked lesson for the same failure, deny the repeat.
3. A warn on spend or on an internal policy is a warning. Show it. A warn is never an allow for a secret.
4. A deny stops the action. Do not add a bypass flag, a force flag, or a second attempt that hides the same payload.

Pipe the tool call through the public checker when the host agent does not already run the hook:

```bash
npx thumbgate@1.37.3 gate-check
```

Send a PreToolUse JSON object on stdin:

```json
{
  "tool_name": "<tool name>",
  "tool_input": { "...": "..." }
}
```

Parse the JSON response. If `hookSpecificOutput.permissionDecision` is `"deny"`, stop the turn and do not run the tool call. Do not rely on the process exit status; denied calls exit with status 0. Treat checker errors or an invalid response as a failure and do not run the tool call.

## After the action

When a gate should have fired and did not, record the miss:

```bash
npx thumbgate@1.37.3 feedback --feedback=down --context="what happened" --what-went-wrong="specific failure" --what-to-change="specific fix" --tags="secrets,pretool"
```

When a deny saved the turn:

```bash
npx thumbgate@1.37.3 feedback --feedback=up --context="what the gate stopped" --what-worked="specific block" --tags="secrets,pretool"
```

Read the counters with:

```bash
npx thumbgate@1.37.3 gate-stats
```

## What this file does not do

- It does not read home-directory credentials, shell profiles, or environment variables to "verify" itself.
- It does not send repository contents anywhere except the three hosts listed above, and only when the user asked to install or open ThumbGate.
- It does not replace branch protection, a human review, or the hosted Pro subscription.
