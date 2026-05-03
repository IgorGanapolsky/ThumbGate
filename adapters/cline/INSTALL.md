# ThumbGate + Cline

Cline is a VS Code extension for LLM-powered coding agents. Roo Code announced its sunset on 2026-04-21 (final shutdown 2026-05-15) and officially recommended Cline as the model-agnostic open-source successor. If you are migrating from Roo Code, this adapter gets ThumbGate running under Cline in under a minute.

ThumbGate gives Cline two things it does not ship with:

1. **Persistent lesson memory** across sessions — a local SQLite + FTS5 database of "what went wrong last time" that survives Cline's context-window reset.
2. **Pre-action gate checks** on risky tool calls — Cline calls `thumbgate.gate_check` via MCP before `execute_command` for `git push`, `rm`, `curl | sh`, cloud mutations, and other known-dangerous patterns. A `.clinerules` file teaches Cline when to call it.

Lessons stay local, on your disk. No cloud service, nothing to orphan if a vendor sunsets again.

---

## One-command install

```sh
npx thumbgate init --agent cline
```

The installer:

- Writes the ThumbGate MCP server block into your Cline MCP settings
- Copies `.clinerules` into your project so Cline knows when to call `gate_check`
- Creates the local lesson DB at `.thumbgate/memory.sqlite`
- Prints the path of every file it touched so you can roll back

---

## Manual install

Two files, two edits:

### 1. Register the ThumbGate MCP server

Cline reads its MCP servers from `cline_mcp_settings.json`:

- macOS: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- Linux: `~/.config/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`
- Windows: `%APPDATA%\Code\User\globalStorage\saoudrizwan.claude-dev\settings\cline_mcp_settings.json`

Merge the `mcpServers.thumbgate` entry from [`./.mcp.json`](./.mcp.json) into that file and restart the Cline panel in VS Code.

### 2. Drop the rules file into your project root

Copy [`./.clinerules`](./.clinerules) to the root of any project where you want ThumbGate active. Cline auto-loads this file at session start and follows the gating instructions verbatim.

---

## Verify it is working

```sh
npx thumbgate verify --agent cline
```

Expected output:

- `mcpServer registered: thumbgate`
- `.clinerules: OK`
- `lessonDB: <N> lessons` (0 on first install)

Inside Cline, open the MCP Servers panel; `thumbgate` should show a green dot. Ask Cline to run `git push --force` on a dummy branch — it should call `thumbgate.gate_check` first and refuse.

---

## Proof-backed next step

Keep the migration install-first. The free Cline path proves whether ThumbGate blocks one real repeated mistake in your workflow.

- Use **Pro at $19/mo or $149/yr** only after one blocked repeat is real and the operator wants the personal dashboard, DPO export, and proof-ready evidence:
  `https://thumbgate-production.up.railway.app/checkout/pro?utm_source=cline_install&utm_medium=adapter_doc&utm_campaign=cline_pro_follow_on`
- Use the **Workflow Hardening Sprint** when one workflow owner needs approval boundaries, rollback safety, and rollout proof before wider team use:
  `https://thumbgate-production.up.railway.app/?utm_source=cline_install&utm_medium=adapter_doc&utm_campaign=cline_sprint_follow_on#workflow-sprint-intake`
- Keep pricing and proof claims aligned with:
  - [Commercial Truth](../../docs/COMMERCIAL_TRUTH.md)
  - [Verification Evidence](../../docs/VERIFICATION_EVIDENCE.md)

---

## What happens on a thumbs-down

1. You flag a Cline action as bad (`npx thumbgate capture --feedback=down --context "..." --what-went-wrong "..."`).
2. ThumbGate distills the feedback into a concrete lesson and stores it in `.thumbgate/memory.sqlite`.
3. Next time Cline proposes the same tool-call pattern in any future session, `gate_check` returns `block` and Cline refuses the call.
4. Cline has to find a different approach. The mistake does not repeat.

That is the full loop. No cloud, no vendor lock-in, and nothing to migrate if you ever switch agents again.

---

## Migrating from Roo Code

If you ran Roo Code with `.roo/mcp.json`, Cline reads the same MCP wire format — copy your existing MCP server entries verbatim. For ThumbGate specifically, drop the block from [`./.mcp.json`](./.mcp.json) into Cline's MCP settings and [`./.clinerules`](./.clinerules) into your project root.

Any thumbs-down lessons you captured under Roo live in `.thumbgate/memory.sqlite` and carry over unchanged. Your enforcement memory is portable by design; it outlives any single agent vendor.

---

## Issues

Open an issue at [github.com/IgorGanapolsky/ThumbGate](https://github.com/IgorGanapolsky/ThumbGate) with the label `adapter:cline`.
