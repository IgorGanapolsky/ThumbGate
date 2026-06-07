# Spec: Threat model + indirection-bypass hardening

> First dogfood spec. Authored 2026-06-07 against the methodology in
> [`docs/PROJECT_MANAGEMENT.md`](../../docs/PROJECT_MANAGEMENT.md).

```yaml
id: 001
use_case: Give users and reviewers an honest, verifiable account of what ThumbGate's hook enforces versus what needs an OS sandbox — so the enforcement model can be trusted.
milestone: Publish a threat model and confirm the stateful-helper-bypass gate covers the documented indirection vectors.
status: draft        # public-facing wording awaits CEO approval
owner: CEO
created: 2026-06-07
```

## 1. Outcomes
- `THREAT_MODEL.md` exists at the repo root, stating plainly the **policy layer vs. containment
  boundary** distinction (a PreToolUse hook is policy + observability, not containment).
- The gate's coverage of the indirection set — `curl|bash`, `chmod +x`→execute, write-then-run,
  package-script wrappers — is documented and backed by tests.

## 2. Scope boundaries
- **In scope:** `THREAT_MODEL.md`; cross-references to the `stateful-helper-script-bypass` gate and
  its tests.
- **Out of scope:** building an OS sandbox — containment is the host's job by design; the doc must
  say so rather than imply the hook provides it.

## 3. Constraints
- Public-facing wording requires explicit CEO approval before merge.
- Must **not** overclaim containment the hook cannot provide (honesty is the point of the doc).

## 4. Prior decisions
- A community review raised the "path around the observed tool" bypass. The
  `stateful-helper-script-bypass` gate addresses the common chains and shipped already; pairing the
  policy layer with an OS sandbox is the correct architecture, not a hook-only model.

## 5. Task breakdown
- [ ] **T1** Add `THREAT_MODEL.md` (CEO-approved wording).
- [ ] **T2** Link it from `README` and the gate's changeset.
- [ ] **T3** Confirm `tests/gates-hardening.test.js` covers each documented vector.

## 6. Verification criteria (acceptance)
- **Outcome 1** → check: `test -f THREAT_MODEL.md && grep -qi 'containment boundary' THREAT_MODEL.md`.
- **Outcome 2** → check: `npm run test:gates-hardening` passes, and the test file references each
  documented vector (curl-pipe-shell, package-script, write-then-run).

> "Done" is the two commands above passing — not anyone's say-so.
