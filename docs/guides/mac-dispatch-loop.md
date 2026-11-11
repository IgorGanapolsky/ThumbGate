# Cloud-to-Mac dispatch loop

Cloud Claude sessions can't reach your Mac directly, but they can open GitHub issues. This loop
turns `ready-for-agent` issues into `claude -p` runs on your Mac and writes the evidence back to
the issue.

```
cloud thread ──opens issue──▶ GitHub (ready-for-agent)
                                  │  poll every 5 min (launchd) or --watch (herdr pane)
                                  ▼
                           Mac: claim ─▶ claude -p in the issue's folder ─▶ evidence comment
                                  │
                                  ▼
                        label: agent-done  or  agent-blocked
```

## Queue a task

Open an issue with the **Ready for Agent** template (it adds the `ready-for-agent` label), or from
a cloud session:

```bash
gh issue create --repo IgorGanapolsky/ThumbGate --label ready-for-agent \
  --title "[Agent] Re-run the weekly revenue report" \
  --body $'### Working directory\n\n~/workspace/ThumbGate\n\n### Acceptance criteria\n\n- report saved and linked'
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

## Labels

| Label | Meaning |
| --- | --- |
| `ready-for-agent` | queued |
| `agent-claimed` | a Mac is running it now |
| `agent-done` | the run ended with `STATUS: DONE`; read the evidence comment before trusting it |
| `agent-blocked` | the run failed, timed out, hit a permission denial it couldn't finish without, or didn't report a status |

The loop creates these labels on its first run. To requeue, swap the result label back to
`ready-for-agent`.

## Several Macs

Each Mac posts a claim comment, waits 5 seconds, then re-reads the comments. The earliest claim
since the issue was last labeled `ready-for-agent` wins, and the others delete their claim and
move on. Set `MAC_DISPATCH_MACHINE_ID` (default: hostname) so the comments say which Mac ran it.

If a Mac sleeps or crashes mid-run, the issue stays `agent-claimed`. Swap it back to
`ready-for-agent` to retry; the old claim is ignored.

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

| Env var / flag | Default |
| --- | --- |
| `MAC_DISPATCH_REPO` / `--repo` | `IgorGanapolsky/ThumbGate` |
| `MAC_DISPATCH_ALLOWED_AUTHORS` / `--allow-author` | repo owner |
| `MAC_DISPATCH_DEFAULT_WORKDIR` / `--default-workdir` | `~/workspace/ThumbGate` |
| `MAC_DISPATCH_WORKDIR_ROOTS` / `--workdir-root` | `~/workspace` |
| `MAC_DISPATCH_MACHINE_ID` / `--machine-id` | hostname |
| `MAC_DISPATCH_TIMEOUT_MINUTES` / `--timeout-minutes` | `45` |
| `MAC_DISPATCH_CLAUDE_ARGS` / `--claude-arg` | none (e.g. `--max-turns 40`) |
| `MAC_DISPATCH_INTERVAL` (installer) / `--interval` (`--watch`) | `300` seconds |

Requires `node`, `gh` (logged in) and `claude` (logged in) on the Mac.
