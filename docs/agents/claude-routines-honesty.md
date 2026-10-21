# Claude Code Routines Governance Honesty (FORMAT Steal)

Sources:
- [Introducing routines in Claude Code](https://claude.com/resources/articles/introducing-routines-in-claude-code)
- [Automate work with scheduled tasks (formerly routines)](https://code.claude.com/docs/en/routines)

## Architectural Ideas Stolen into `scripts/workspace-agent-routines.js`

1. **`<routine-fire-payload>` Untrusted Taint Diode (`wrapRoutineFirePayload`, `evaluateFirePayloadAdmission`)**
   - Dynamic `text` sent to an API `/fire` endpoint or **Run now** is wrapped in `<routine-fire-payload untrusted="true">...</routine-fire-payload>` with nested `</routine-fire-payload>` tags escaped.
   - Unless the saved routine prompt explicitly references `routine-fire-payload`, the payload is treated as inert context (`inert_unreferenced_context`).
   - Any payload attempting prompt injection or approval spoofing (`--admin`, `approve_protected_action`, `ignore previous instructions`) is blocked pre-execution.

2. **Trigger $\neq$ Human Consent Invariant (`canActAsHumanApproval: false`)**
   - A trigger attests only that the prompt was stored ahead of time; neither the saved prompt nor `<routine-fire-payload>` can satisfy human-review or protected-action gates during an unattended run.

3. **Schedule Floor, Off-Hour Jitter, & Rate Caps (`validateRoutineSchedule`, `evaluateRoutineRateLimits`)**
   - Enforces the 1-hour minimum cron interval (rejecting sub-hourly cron expressions), flags `:00` top-of-hour queue contention in favor of `:07` offsets, auto-disables `one_off` schedules to `completed` after firing, and returns `nextRunAt: null` (never Year 1) for API-only or GitHub-only routines.
   - Enforces per-task (`30/h`), per-account (`100/h`), and plan-tier daily limits (`pro: 5/d`, `max: 15/d`, `team: 25/d`, `enterprise: 25/d`).

4. **GitHub Webhook Filter Engine (`evaluateGitHubRoutineTrigger`)**
   - Evaluates `pull_request` and `release` events across all 8 filter fields (`author`, `title`, `body`, `base_branch`, `head_branch`, `labels`, `is_draft`, `is_merged`) and 6 operators, enforcing full-string regex matching (`^(?:...)$`) on `matches_regex` (`.*hotfix.*` matches substrings; bare `hotfix` matches only exact `"hotfix"`).

5. **Connector Least-Privilege & Green-Exit Honesty (`auditRoutineConnectors`, `auditRoutineRunOutcome`)**
   - Strips unreferenced default-attached MCP connectors and blocks outbound mail/social write connectors (`Gmail`, `Apple Mail`, `LinkedIn`, `X`).
   - Rejects completion claims based on a green session exit indicator when the transcript logs `403 x-deny-reason: host_not_allowed`, missing connector tools, or unverified test output.

## CLI Usage

```bash
npx thumbgate claude-routines-honesty --json
npx thumbgate claude-routines-honesty --map-only --json
```
