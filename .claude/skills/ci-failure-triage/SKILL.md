---
name: ci-failure-triage
description: >
  Triage a CI / PR check failure by READING the failure body before forming any
  hypothesis. Triggered whenever a required check is red, a PR is BLOCKED, a merge
  won't land, or you're about to call a failure "transient", "flaky", "stale", or
  "orphaned". Prevents dismissing a real failure (e.g. real CodeQL security alerts)
  as noise.
---

# CI Failure Triage — Read Before You Conclude

## The failure this prevents

Calling a red check "transient / flaky / orphaned / stale" WITHOUT reading its
body. This session: a CodeQL check failed; it was dismissed as a "transient 4s
orphaned check-run" — twice — when it was reporting **3 real security
vulnerabilities** (2 critical command-injection + 1 high XSS). The conclusion came
before the evidence. (2026 failure-triage practice = taxonomy → read → cluster →
gate, a *repeatable detection system*, not vibes:
https://latitude.so/blog/ai-agent-failure-modes-detection-playbook)

## Hard rule

**You may not use the words "transient", "flaky", "stale", "orphaned", or
"unrelated" about a check until you have read its failure body and quoted the
actual error.** A duration (e.g. "4s") is a hint, never proof.

## Protocol (in order — do not skip)

1. **Identify the exact failing check + its commit.**
   ```bash
   head=$(gh pr view <N> --json headRefOid -q .headRefOid)
   gh pr checks <N> | grep -viP "\t(pass|skipping)\t"
   ```

2. **Read the failure body. This is the step that gets skipped.**
   - GitHub Actions job: `gh run view --job <id> --log-failed | tail -40`
   - CodeQL / code-scanning: read the ALERTS, not just the check:
     ```bash
     gh api "repos/<owner>/<repo>/code-scanning/alerts?state=open&per_page=100" \
       --jq '.[] | "\(.rule.id) | \(.rule.security_severity_level) | \(.most_recent_instance.location.path):\(.most_recent_instance.location.start_line) | ref=\(.most_recent_instance.ref)"'
     ```
   - Also fetch the check-run's `output.title` / `output.summary` — it usually
     states exactly what failed ("2 new alerts including 2 high severity…").

3. **Classify against branch protection.** Map each REQUIRED context to its real
   state on the head commit, so you know what actually blocks:
   ```bash
   gh api repos/<owner>/<repo>/branches/main/protection/required_status_checks -q '.contexts[]'
   gh api "repos/<owner>/<repo>/commits/$head/check-runs" --paginate \
     -q '.check_runs[] | "\(.name)=\(.conclusion)"'
   ```

4. **THEN form a hypothesis,** and only with one of these supported verdicts:
   - **REAL** — the body shows a genuine defect → fix the code, add a test.
   - **PRE-EXISTING** — same alert exists on `main` independent of your diff
     (prove it: query alerts on `refs/heads/main`). Diff-attributed but not yours;
     still must be fixed to unblock — fix it or get an explicit dismissal decision.
   - **INFRA** — the *log* shows a runner/network/quota error (quote the line).
     Only now may you re-run. "It was fast" is not an INFRA verdict.

5. **Re-run only after an INFRA verdict** with a quoted log line. Re-running a
   green-workflow-but-red-check loop forever does nothing if the real blocker is a
   pinned failed check-run from a prior commit — push a fresh commit instead.

## "Are you sure?" interaction

If the CEO asks "are you sure?" about a CI claim, your triage was superficial.
Re-run this protocol from step 2 (read the body) before answering. See
`evidence-first-answer`.

## Anti-patterns

| Pattern | Fix |
|---|---|
| "CodeQL failed in 4s — transient, re-running" | Read `output.summary` + alerts first; 4s ≠ proof |
| Resolving a review/scan thread to clear a gate | Address the finding in code; resolving ≠ fixing |
| Re-running a failed check repeatedly with no log read | One read; classify REAL/PRE-EXISTING/INFRA; act on the class |
| "Unrelated to my change" without checking main | Query alerts on `refs/heads/main` to prove pre-existing |

## Exit criteria

Every red required check is classified with quoted evidence and either fixed
(REAL/PRE-EXISTING) or re-run after a quoted INFRA log line. Never declare CI green
without `gh pr checks` showing it.
