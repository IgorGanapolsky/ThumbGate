# Mantis critic/review (InfoQ FORMAT, not a clone)

Public: InfoQ 2026-09-06 / Sergio De Simone
https://www.infoq.com/news/2026/09/google-mantis-vulnerability-scan/

We are not Google Mantis. Industry true-positive often <7% is their cited problem, not our telemetry.

## FORMAT stolen onto existing rails

| Public claim | ThumbGate mapping |
| --- | --- |
| Critic + reviewer + rule-based negative filter | `evaluateFindings` — do not auto-FP low-risk |
| Context-first, not brute-force file scan | `brute_force_scan` / `missing_hierarchical_summary` / `missing_finding_context` |
| Parse the action, not a substring | `parseGhApiAction` + `substring_not_action` (#3822 analog) |
| Sandboxed reproduction as grounding | `promote_without_reproduction` / `needs_reproduction` |
| LLM judgment of FP | `llm_judgment_not_grounding` |
| 85% token cut / Mantis skills harness | `not_wired` |

## Fail closed

- missing findings → `findings_inventory_unavailable`
- `modelSaidSafe` → `model_cannot_grant_authority`
- empty `--decide` → `missing_decide_payload`
- `--claim-live` → deny (including when combined with `--decide`)

## Out of scope (ECI)

No google/mantis clone. No vulnerability-scanner SKU. No `config/gates/default.json` dual-edit. No packing. No untracked `mantis-vulnerability-scanner.js` theater. No LLM adjudicator (#3690/#3687).
