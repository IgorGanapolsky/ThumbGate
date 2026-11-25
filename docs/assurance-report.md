# Agent assurance report

`npx thumbgate assurance-report` turns ThumbGate's local decision log into one
report a team lead, security reviewer or auditor can read in five minutes.

ThumbGate finds risky agent actions. People decide what to do about them. The
report shows both sides, and every number points back to a log line.

## What's in it

1. **Summary.** How many agent actions were checked, allowed, stopped before
   they ran, flagged with a warning, or let through by a person (override).
2. **Fix first.** Every rule that fired, ranked by severity times how often it
   fired. A rule near the top that keeps firing means the agent keeps trying
   the same thing, so fix the prompt, task setup or tool access behind it
   rather than just blocking it forever.
3. **What people decided.** Thumbs up, thumbs down (each becomes a lesson) and
   overrides in the same window.
4. **Evidence.** The decision log path and its SHA-256 at report time, the rule
   catalog versions that were active, the ThumbGate version, and sample log
   entry ids per rule. Anyone can re-check a number against the raw log.

## Usage

```bash
npx thumbgate assurance-report                    # last 30 days, Markdown to stdout
npx thumbgate assurance-report --days=7           # last week
npx thumbgate assurance-report --out=report.md    # save to a file
npx thumbgate assurance-report --json             # machine-readable
```

It reads only local files in your ThumbGate data folder (default
`~/.thumbgate`): `audit-trail.jsonl` and `feedback-log.jsonl`. Nothing is sent
anywhere. Tool inputs are not copied into the report; it lists rule ids, rule
messages, counts and times.

## Good uses

- The close-out of a 30-day team pilot: start with one repo and one agent, run
  the report at the end, then widen to the rest of the team.
- A weekly check-in: run `--days=7` and work the top three "fix first" rules.
- Evidence for a security review: attach the Markdown and the log digest.
