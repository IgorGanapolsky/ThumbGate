# Claim gate: a recorded lesson changes the next reply

A thumbs-down lesson such as "never say a tab is closed without a check from this turn" used to be stored and then ignored. `scripts/claim-gate-stop.js` is a Claude Code Stop hook that reads the lessons back at the moment they matter.

## What it does

On every Stop, it reads the assistant's reply for the current turn and blocks once when all three are true:

1. A sentence states the present condition of something outside the conversation: open, closed, sent, running, replied, absent, waiting, blocked ("Nothing watches the chat", "tinyNature hasn't replied yet").
2. The turn made no tool call that could have checked it. Planning and question tools do not count as a check.
3. The sentence carries no label.

The block reason quotes the sentence and the top three negative lessons from ThumbGate memory that match it, then asks for a check or a label.

## Labels that let a claim through

- `live` as a label: `Live: ...`, `(live)`, `checked live`, `live check`
- `as of 12:44 PM`, `as of my last read`
- `not checked`, `unverified`, `I haven't checked`
- `per the script output`, `saved reading`, `I don't know`

Questions, hedged sentences (`if`, `whether`, `might`), quoted lines and code blocks are not claims.

## Block once

Claude Code runs a blocked Stop hook again with `stop_hook_active: true`. The hook always allows that run, so a reply cannot loop. Any internal error also allows.

## Install

Add to `~/.claude/settings.json` (all projects) or a project's `.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      { "hooks": [ { "type": "command", "command": "THUMBGATE_FEEDBACK_DIR=$HOME/.thumbgate node /path/to/ThumbGate/scripts/claim-gate-stop.js" } ] }
    ]
  }
}
```

Set `THUMBGATE_FEEDBACK_DIR` to the same directory your ThumbGate MCP server uses (check the `env` of the `thumbgate` entry in `.mcp.json`). With it unset, the hook reads the memory of whatever project directory the session is in, which can be a nearly empty one, and the block then quotes unrelated lessons. Turn the hook off with `THUMBGATE_CLAIM_GATE=0`.

## Measure repeats

```bash
node scripts/claim-gate-stop.js --replay <transcript.jsonl> --since <ISO time>
```

Prints the number of turns scanned and the turns that would have been blocked. A turn that made any non-planning tool call counts as checked, so this undercounts claims that follow an unrelated tool call.

## Limits

- It checks wording, not truth. A labelled claim passes even when the label is wrong.
- A tool call anywhere in the turn counts as a check, even one unrelated to the claim.
- The patterns cover English status wording; unusual phrasing is not caught.
- Tests: `npm run test:claim-gate-stop`.
