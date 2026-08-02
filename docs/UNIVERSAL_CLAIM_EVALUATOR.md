# Universal Claim Evaluator

ThumbGate already blocked completion claims that lacked session `track_action` evidence (regex claim gates + goal contracts). That still left a hole: agents could assert concrete facts like **"the row count is 1,284"** without anyone rechecking the database or filesystem.

The universal claim evaluator closes that hole.

## What it does

1. **Parse** free-text factual claims from agent output.
2. **Match** each claim to an operator-configured verifier (never trust paths/SQL from the claim text).
3. **Recheck** the live source of truth.
4. **Fail closed** on mismatch, verifier error, or parseable claim with no configured verifier.

Wired into:

- `verifyClaimEvidence()` in `scripts/gates-engine.js`
- MCP tools `verify_claim` and `require_evidence_for_claim`
- the configured Claude Code Stop hook (`scripts/hook-stop-anti-claim.js`),
  which hard-blocks a parsed mismatch even when the agent never calls MCP
- the portable `thumbgate verify-claims` CLI for other agent runtimes and CI
- npm script `test:universal-claim-evaluator`

## Supported claim shapes (v1)

| Claim example | Kind |
|---|---|
| `the row count is 1,284` | `count` |
| `there are 42 orders` | `count` |
| `COUNT(*) = 10` | `count` |
| `file README.md has 120 lines` | `file_lines` |
| `bundle.js is 4096 bytes` | `file_bytes` |
| `config.json exists` | `file_exists` |
| `secrets.env does not exist` | `file_exists` |
| `package version is 1.31.0` | `value` |

## Configure verifiers

ThumbGate ships a default config at `config/gates/claim-verifiers.json` that
rechecks `package version` and `package.json` existence. For project-specific
facts (row counts, inventory files, service health), copy the example and edit:

```bash
cp config/gates/claim-verifiers.example.json .thumbgate/claim-verifiers.json
```

Load order:

1. `options.verifiers` / `options.claimVerifiers` (tests / MCP callers)
2. `options.configPath` or `$THUMBGATE_CLAIM_VERIFIERS_PATH`
3. `$THUMBGATE_FEEDBACK_DIR/claim-verifiers.json`
4. `.thumbgate/claim-verifiers.json`
5. `config/gates/claim-verifiers.json` (shipped default)

An existing but malformed config is a verifier error. ThumbGate does not skip
it and silently fall through to a different file.

### Verifier kinds

| kind | Required fields | Notes |
|---|---|---|
| `sqlite_count` | `dbPath`, `query`, `match.subjects` | Query must be a single `SELECT`. Paths are repo-relative. |
| `file_lines` | `path`, `match.paths` | Counts newline-delimited lines. |
| `file_bytes` | `path`, `match.paths` | Uses `fs.statSync().size`. |
| `file_exists` | `path`, `match.paths` | Boolean expected true/false. |
| `json_path` | `path`, `jsonPath` | Dot path only (e.g. `version`). |

The operator-configured `path` is always the file that gets read. Claim text
may select an exactly matching verifier but cannot redirect it to a lookalike
basename. Absolute paths, `..` escapes, and in-root symlinks that resolve
outside the root are rejected.

## Runtime behavior

| Situation | Result |
|---|---|
| No parseable factual claims | Neutral — existing session-action / goal-contract gates still apply |
| Parseable claim + matching verifier + equal values | `verified: true` for that check |
| Parseable claim + mismatch | `verified: false`, blocking under `require_evidence_for_claim` |
| Parseable claim + no verifier | `status: unconfigured`, fail-closed by default |
| Verifier throws | `status: verifier_error`, fail-closed |

## Example

```js
const { evaluateUniversalClaims } = require('./scripts/universal-claim-evaluator');

const result = evaluateUniversalClaims('the row count is 1,284', {
  cwd: process.cwd(),
  verifiers: [{
    id: 'orders-row-count',
    kind: 'sqlite_count',
    match: { subjects: ['row count', 'orders'] },
    dbPath: 'data/app.sqlite',
    query: 'SELECT COUNT(*) AS n FROM orders',
  }],
});

// result.verified === false when DB has a different count
```

MCP:

```json
{
  "name": "require_evidence_for_claim",
  "arguments": {
    "claim": "the row count is 1,284 and all tests pass",
    "mode": "blocking"
  }
}
```

If the DB count is not 1284, the tool returns `blocking: true` even if `tests_passed` was tracked.

Portable CLI / CI:

```bash
npx thumbgate verify-claims \
  --claim='the row count is 1,284' \
  --config=.thumbgate/claim-verifiers.json \
  --json
```

Exit `0` means every parsed claim matched. Exit `1` means mismatch,
unconfigured claim, malformed config, or verifier failure. Agent runtimes that
do not support Claude Stop hooks must invoke this command or the MCP completion
gate before accepting output; ThumbGate cannot intercept a runtime that has no
hook, MCP, or CLI integration.

## What this is not

- Not an unbounded NL-to-SQL compiler. Queries are operator-authored only.
- Not a substitute for session `track_action` evidence on qualitative claims ("design matches Figma").
- Not a guarantee that every English sentence is parsed — only the listed factual shapes.
- Not permission to market an arbitrary-English or every-runtime guarantee.
  The deterministic guarantee covers supported claim shapes on runtimes wired
  through the Stop hook, MCP gate, or CLI exit code.
