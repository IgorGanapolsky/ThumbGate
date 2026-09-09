# Break-glass --gates propose (#3702 leftover)

https://github.com/IgorGanapolsky/ThumbGate/issues/3702

`break-glass` today unlocks hook settings + PR-create TTL. It does **not** cover `self-protect-config`. The leftover is a propose-only `--gates` path: a unified diff of `config/gates/default.json`, never a live write.

## Fail closed

- missing reason → `missing_reason`
- missing gate ids → `missing_gate_ids`
- `--apply` / writePath = default.json → `live_apply_refused`
- empty `--decide` → `missing_decide_payload`
- `--claim-live` → deny

## Out of scope

No live `default.json` rewrite. No `THUMBGATE_SELF_PROTECT_OVERRIDE`. No untracked `break-glass-gates.js` theater. No packing. Matcher ACs already shipped in #3822.
