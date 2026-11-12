# Cloud-to-Mac dispatch loop

Cloud Claude sessions can't reach your Mac directly, but they can open GitHub issues. This loop
turns issues whose body contains `<!-- agent:ready -->` into `claude -p` runs on your Mac and writes the evidence back to
the issue.

Flow: cloud thread opens issue → Mac claims it → `claude -p` in the issue folder → evidence comment → `<!-- agent:done -->` or `<!-- agent:blocked -->`.

## Queue a task

Open an issue with the **Ready for Agent** template (it puts `<!-- agent:ready -->` in the body and adds no label), or from
a cloud session:

```bash
gh issue create --repo IgorGanapolsky/ThumbGate \
  --title "[Agent] Re-run the weekly revenue report" \
  --body $'<!-- agent:ready -->\n\n### Working directory\n\n~/workspace/ThumbGate\n\n### Acceptance criteria\n\n- report saved and linked'
```

The whole issue body is the prompt. **Working directory** is optional; blank means
`~/workspace/ThumbGate`.

## Run it on the Mac

One tick, to try it:

```bash
cd ~/workspace/ThumbGate
node scripts/mac-dispatch-loop.js --once --dry-run   # shows what would run, changes nothing
node scripts/mac-dispatch-loop.js --once
```

Every 5 minutes with launchd:

```bash
bash scripts/install-mac-dispatch-launchd.sh          # logs: ~/Library/Logs/thumbgate-mac-dispatch.log
bash scripts/install-mac-dispatch-launchd.sh --uninstall
```

Or in a herdr pane, so you can watch it work:

```bash
node scripts/mac-dispatch-loop.js --watch --interval 300
```

Pick launchd **or** a herdr pane on a given Mac. Running both is safe (a local lock skips the
overlapping tick) but pointless.

## Queue signal

| Signal | Meaning |
| --- | --- |
| `<!-- agent:ready -->` in the body | queued. This is not a label. |
| `<!-- agent:claimed -->` in the body | a Mac is running it now. This is not a label. |
| `<!-- agent:done -->` in the body | the run ended with `STATUS: DONE`; read the evidence comment before trusting it |
| `<!-- agent:blocked -->` in the body | the run failed, timed out, hit a permission denial it couldn't finish without, or didn't report a status |

The loop does not create or apply `ready-for-agent`, `agent-done`, `agent-claimed`, or `agent-blocked`. To requeue, put `<!-- agent:ready -->` back in the body and remove `<!-- agent:done -->`, `<!-- agent:blocked -->`, and `<!-- agent:claimed -->`.

## Several Macs

Each Mac posts a claim comment, waits 5 seconds, then re-reads the comments. The earliest claim
since the issue was queued wins, and the others delete their claim and
move on. Set `MAC_DISPATCH_MACHINE_ID` (default: hostname) so the comments say which Mac ran it.

If a Mac sleeps or crashes mid-run, the issue body keeps `<!-- agent:claimed -->`. Put `<!-- agent:ready -->` back in the body and remove `<!-- agent:claimed -->` to retry; the old claim comment is ignored.

## Permissions and safety

- The loop runs `claude -p --output-format json` under **your** Claude Code permission settings.
  It never passes `--dangerously-skip-permissions` or `--permission-mode bypassPermissions`, and
  it refuses to start if you add them with `--claude-arg` or `MAC_DISPATCH_CLAUDE_ARGS`.
- Unattended runs can't answer permission prompts, so anything not already allowed is denied and
  shows up as "permission denials: N" in the evidence comment. To let runs do more, add allow
  rules yourself in `~/.claude/settings.json` or the repo's `.claude/settings.local.json`.
- Only issues written by allowed authors run (default: the repo owner). Issue templates add their
  labels for anyone who opens an issue on a public repo, so the author check is what stops a
  stranger's issue from running on your Mac. Add more with `--allow-author` or
  `MAC_DISPATCH_ALLOWED_AUTHORS=a,b`.
- Folders are limited to `~/workspace` by default (`MAC_DISPATCH_WORKDIR_ROOTS=dir1:dir2`).
- The evidence comment is public on a public repo. Output is passed through
  `scripts/secret-redaction.js`, but don't queue tasks whose output you wouldn't post.
- Each run stops after 45 minutes (`--timeout-minutes`). One issue per tick (`--max-issues`).

## Evidence comment

Each result comment lists the machine, folder, command, exit code, duration, Claude session id,
turns, cost, permission denials, git branch and SHA before and after, every link in the output,
and the last 12k characters of the output. Missing values are written `UNKNOWN`. A local receipt
log is kept at `~/.thumbgate-dispatch/receipts.jsonl`.

## Settings

Run `node scripts/mac-dispatch-loop.js --help` for flags. Each has a `MAC_DISPATCH_*` env var
(`REPO`, `ALLOWED_AUTHORS`, `DEFAULT_WORKDIR`, `WORKDIR_ROOTS`, `MACHINE_ID`, `TIMEOUT_MINUTES`,
`CLAUDE_ARGS`); the launchd installer passes them through, plus `MAC_DISPATCH_INTERVAL`.

Requires `node`, `gh` (logged in) and `claude` (logged in) on the Mac.
