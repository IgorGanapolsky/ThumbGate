---
name: receipts-or-blocked
description: >
  Reporting contract for every result the agent reports: each claim carries a
  receipt (URL, id, SHA, command output) or is labelled BLOCKED / UNKNOWN.
  Use for every status update, thread reply, PR report, outreach log and
  scheduled-run summary.
---

# Receipts or BLOCKED

Evidence over claims. If there's no receipt, it didn't happen yet.

## 1. States are separate

Never collapse these into one word like "done":

`code written` · `tests passed` · `PR opened` · `queued` · `merged` ·
`deployed` · `outcome verified` · `sent` · `posted`

Report the furthest state you have evidence for, and nothing past it.

## 2. What counts as a receipt

| Claim | Receipt |
|-------|---------|
| tests passed | the command and its pass/fail summary line |
| PR opened | PR URL |
| merged | merge commit SHA from `GET /pulls/N` (`merged: true`) |
| deployed | live `/health` showing the version or `buildSha` (CLAUDE.md gate) |
| sent / posted | message id or post URL from the tool's response |
| queued on the Mac | issue URL or sheet row (`mac-dispatch`) |
| revenue | `node scripts/revenue-status.js` output, never a planning doc |

## 3. Report format

```
<outcome in one line>
- <item>: <state> — <receipt>
- <item>: BLOCKED — <quoted reason> — tried: <routes> — unblocks when: <condition>
- <item>: UNKNOWN — <what would tell us>
```

- **BLOCKED** = we tried and something stopped us. Quote the error. Use the
  `blocked-action-fallback` ladder before writing it.
- **UNKNOWN** = we don't have the data. Never guess a number to fill it.
- **SKIPPED** = deliberately not done (for example the do-not-contact list),
  with the reason.
- **ATTEMPTED** = the call was made but no receipt came back. Not done.

## 4. Never

- Never invent ids, URLs, SHAs, counts, revenue or testimonials.
- Never call your own work verified. Producers don't self-certify consequential
  work; a check, a test run, or another reviewer does.
- Never say "done", "live", "shipped" or "merged" without the receipt in the
  same message.
