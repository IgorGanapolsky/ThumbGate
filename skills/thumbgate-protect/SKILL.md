---
name: thumbgate-protect
description: Inspect this repo's branch and release governance (protected branches, release rules, protected-file globs) and, only when the user explicitly approves, grant a scoped, time-limited exception so a protected-file edit or publish can proceed under audit. Reads posture via the get_branch_governance MCP tool and records a narrow, expiring approval via the approve_protected_action MCP tool. Use when the user says "is main protected", "show branch governance", "what am I blocked from editing", "approve this protected change", or "let me edit a protected file just this once". Do NOT use to disable protection wholesale, to grant broad or standing exceptions, or to diagnose hook wiring (use the thumbgate-doctor skill) — this skill is for narrow, temporary, audited approvals only.
---

# ThumbGate Protect

Inspect the protected-action posture for this project and, when the user explicitly approves,
grant a scoped, expiring exception so a protected-file edit or publish can proceed under audit.

This skill wraps existing ThumbGate capability and adds **no new logic** — it reads governance
state and records a time-boxed approval.

## Workflow

1. **Read the posture** with the `get_branch_governance` MCP tool: protected branches, release
   rules, and the protected-file globs in effect.
2. **Report it plainly:** what is protected, and what the agent is currently blocked from touching
   without approval.
3. **Only if the user explicitly asks to proceed,** grant a scoped approval with the
   `approve_protected_action` MCP tool — keep `pathGlobs` to the smallest set the action needs and
   `ttlMs` as short as the task requires (default ~1 hour).
4. **Confirm** the approval id, covered globs, and expiry. Approvals are temporary and audited;
   re-run for the next task.

The full `approve_protected_action` field contract (`pathGlobs`, `reason`, `evidence`, `ttlMs`) and
the audit model are in
[references/governance-and-approvals.md](references/governance-and-approvals.md).

## Example

Input: "main is protected but I need to hotfix the changelog — approve it for this one edit"

Action:
1. `get_branch_governance` → confirm `main` is protected and `CHANGELOG.md` is in a protected glob.
2. `approve_protected_action` → `pathGlobs: ["CHANGELOG.md"]`, `reason: "hotfix changelog entry"`,
   `evidence: "owner OK in thread"`, `ttlMs: 900000` (15 min).
3. Report: approval id + "CHANGELOG.md is editable for 15 minutes, then protection resumes."

## Troubleshooting

- **`get_branch_governance` returns nothing:** no governance configured — say so; don't invent
  protected branches.
- **User wants a broad/standing exception:** decline. Grant the smallest glob + shortest TTL, or
  suggest changing governance config deliberately instead.
- **Approval granted but edit still blocked:** the glob may not cover the file, or the TTL expired —
  re-check `pathGlobs`/expiry; if the MCP path is unreachable, run the thumbgate-doctor skill.

## Quality checklist (self-verify before delivering)

- [ ] I read the live posture with `get_branch_governance` before saying anything about protection.
- [ ] I granted an approval ONLY after the user explicitly asked to proceed.
- [ ] I used the smallest `pathGlobs` and the shortest workable `ttlMs`, never a blanket exception.
- [ ] I reported the approval id + covered globs + expiry, and noted protection resumes after.
- [ ] I added no new logic — only read governance and recorded an existing time-boxed approval.
