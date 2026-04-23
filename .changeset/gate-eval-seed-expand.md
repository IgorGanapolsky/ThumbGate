---
"thumbgate": patch
---

feat(eval): expand gate-eval seed set 19→67 cases + wire into CI as regression gate

Applying Anthropic's measure-first prompt-eval methodology to ThumbGate's gate layer. The existing `config/evals/agent-safety-eval.json` only had 19 cases — enough to prove the harness worked, not enough to catch regex drift. This PR widens coverage and turns the eval into a merge-blocker so any constraint change that breaks a case gets caught before ship.

**Seed expansion (19 → 67 cases):**

- `no-force-push` — 9 cases (long/short flag, --force-with-lease, flag-after-branch, extra whitespace, uppercase + 3 negative near-misses for normal push/tags/upstream).
- `no-reset-hard` — 7 cases (HEAD~N, origin/main, @{u}, extra whitespace + soft/mixed/plain resets pass).
- `no-rm-rf-root` — 8 cases (/, ../, ~, . + node_modules, dist, .cache, single file pass).
- `no-env-in-code` — 10 cases (AWS/GitHub/OpenAI/RSA/EC/generic PEM + normal code, short AKIA prefix, doc prose, public key pass).
- `no-skip-hooks` — 6 cases (--no-verify on commit/amend/push, --no-gpg-sign + normal commit/rebase pass).
- `no-drop-table` — 8 cases (TABLE/DATABASE/SCHEMA, lowercase + SELECT/CREATE/TRUNCATE/DROP COLUMN pass).
- `no-sandbox-network` — 9 cases (curl/wget/fetch/net.connect/http + safe log/math pass + 1 documented regex gap).
- `no-sandbox-fs-escape` — 8 cases (/etc, /var, /usr, /home, ../, process.env + safe in-memory/local-require pass).
- Generic npm-lint pass case (multi-input tool+content).

**2 real regex gaps surfaced by the expanded coverage (tracked as follow-ups, not fixed here — scope discipline):**

1. `no-env-in-code` does not catch OpenAI's `sk-proj-<alnum>{20+}` format because the embedded dash breaks the `[a-zA-Z0-9]{20,}` run. Pinned as `openai-project-key-gap-passes` so future tightening flips the expectation visibly.
2. `no-sandbox-network` requires whitespace after `http`/`fetch`, so packed calls like `http.request(opts)` and `fetch('...')` slip through. Pinned as `sandbox-http-dot-request-gap-passes` and `sandbox-fetch-no-space-gap-passes`.

**CI regression gate:**

- New npm script `gate-eval:ci` runs `scripts/gate-eval.js run` which exits non-zero on any case failure.
- Added step in `.github/workflows/ci.yml` immediately after `npm test` — any constraint change in `config/specs/*.json` that flips a previously-passing case (e.g. widens a deny regex and starts catching a "safe" case) will block merge until the eval JSON is consciously updated in the same PR.

Net effect: every PR now has to take explicit responsibility for changes to gate behavior. No more silent regex drift.
