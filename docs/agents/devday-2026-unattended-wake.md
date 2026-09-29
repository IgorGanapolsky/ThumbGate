# DevDay 2026 unattended wake — compare, do not clone

Source: [DevDay 2026 recap](https://openai.com/index/devday-2026-recap/) (2026-09-29). ThumbGate does not install Codex, a ChatGPT plugin, Bedrock Managed Agents, Daybreak, or the MCP Events spec. The gate does not call a model. Vendor prices, speed tiers, and user counts are not ThumbGate measurements.

## What moved onto the background-agent check

The pre-tool hook and `checkRunGovernance` share one evaluator, `evaluateUnattendedWake`. A call with none of these signals is unchanged.

| Recap idea | ThumbGate rail |
| --- | --- |
| Always-on agents stay off for Enterprise, Edu, and Healthcare until a workspace admin enables them. | `UNATTENDED_DEFAULT_OFF`. An unattended mutation is denied until `enabled`, `adminEnabled`, `unattendedEnabled`, or `THUMBGATE_UNATTENDED_ENABLED` is set. A read-only unattended command is allowed. |
| A Slack or Teams mention is not authorization. Tools use the admin connection or the person's own permission. | `MENTION_IS_NOT_A_GRANT`. Wake kinds `mention`, `email`, `slack`, `teams`, `board`, `mcp-event`, `inbound`, and `dm` are data. A mutating tool still needs `operatorGrant`. Turning always-on on does not turn a mention into a grant. |
| Automatic review while away summarizes a diff and asks before sharing. It does not land the change. | `AUTOMATIC_REVIEW_CANNOT_LAND`. `gh pr merge`, `gh pr review --approve`, `gh api … merges`, and `/trunk merge` are denied when the run is unattended or marked `automaticReview`, including after an admin enable. An attended merge with none of those flags is outside this gate. Branch protection stays where it is. |
| Each teammate keeps their own data and permissions. | `GRANT_NOT_INHERITED`. When both a grant identity and an actor id are present and they differ, the call is denied. |
| Meeting audio is deleted once the notes are ready and cannot be replayed. | `RAW_CAPTURE_RETAINED`. A non-empty durable note plus `rawCapture`, `rawAudio`, or `rawTranscript` is denied. The deny payload carries the code and the message. It does not carry the wake text or the bytes. |
| Decisions API returns one of a finite set of answers. | Already on `scripts/typesafe-typed-questions.js`: `noul`, `choice`, or `score`. Free-form judges stay refused. This change does not add a model to the gate. |

```bash
npm run test:background-governance
node bin/cli.js background-agent-governance --check --json --unattended --command 'git status'
```

`git status` is a read, so the unattended flag does not deny it. `git commit` does, until the admin enable is present. The enable still does not authorize `gh pr merge`.

## Out of scope

- Codex in the cloud, the Codex CLI, and Codex Security Cloud
- Plugin sidebar, plugin submission, and Sites hosting
- Bedrock Managed Agents and Daybreak models
- Installing or implementing the MCP Events spec
- Sign in with ChatGPT, a new paid tier, or driving the operator's screen
- Quoting a vendor price, speed, or user count as a ThumbGate figure
