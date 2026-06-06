# 2026-06-04 Technical Debt Audit Notes

## Decisions

- Used a clean worktree at `/tmp/thumbgate-tech-debt-audit-20260604` so the dirty primary checkout would not be touched.
- Fixed the observed main CI failure first because it was a deterministic operational blocker with an exact log: the workflow sentinel branch-contract test depended on the ambient branch.
- Changed IDE marketplace publishing to skip external publication when optional marketplace tokens are missing, while still packaging and uploading the VSIX artifact.

## Assumptions

- VERIFIED: `main` was failing on the workflow sentinel test and the IDE marketplace publish-token check.
- VERIFIED: The marketplace workflow had already built and packaged the VSIX before failing on absent external publish secrets.
- VERIFIED: RAG/lesson DB, orchestration proofs, automation proofs, and self-heal checks pass locally after the changes.
- UNVERIFIED: GitHub Actions branch CI for this PR will be green until the pushed PR run finishes.

## Corrections

- The full coverage run generated `tests/proof-test-sandbox/`; it was untracked runtime output and was removed with `trash`.
- The Gemini/Vertex path logged an OAuth timeout during the broad coverage run, but the test recovered and passed. Do not cite that path as externally healthy without a live credentialed probe.

## Reviewer Notes

- This is not a sweeping line-by-line cleanup of all 478k tracked lines. It is a bounded audit plus the highest-confidence cleanup that directly turns red main CI into an actionable fix.
- Coverage remains below 100% at `87.58%`; the report lists the lowest visible modules for follow-up coverage work.
