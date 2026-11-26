# npm strategy for `thumbgate`

Measured 25 Nov 2026 on main at v1.45.0. Every number below came from a command listed beside it. Nothing here was published, tagged or deprecated.

## Summary

| Question | Finding | Evidence command |
| --- | --- | --- |
| Cadence | 18 versions in the 14 days to 25 Nov (134 in total). Every merge that touches `package.json` on main publishes to `latest`. | `npm view thumbgate time --json` |
| Size | 10,809,198 bytes unpacked, 727 files, 3.1 MB tarball. The ratchet in `tests/package-boundary.test.js:833` is 10,820,000, so 10,802 bytes of headroom. | `npm pack --dry-run --json` |
| Install weight | A clean `npm i thumbgate@1.44.0` is 761 MB on disk. 545 MB of it (72%) is `@lancedb/lancedb` (262 MB, mostly its native binary) and its dependency `@huggingface/transformers` → `onnxruntime-node` (184 MB) plus `onnxruntime-web` (99 MB). | `du -sk node_modules/*` in a temp dir |
| Install path | `npx thumbgate@1.44.0 init` with a temp HOME: exit 0 in 23 s (cold cache), `doctor` exit 0 in 1 s, 0 "Cannot find module". | see "Install path" |
| Security | `npm audit --omit=dev`: 0 vulnerabilities. One install script (`postinstall`, prints a banner, exits 0 on CI and on error). 10 runtime dependencies. | `npm audit --omit=dev --json` |
| Provenance | Already on. `1.44.0` carries a SLSA provenance attestation; `publish-npm.yml` uses OIDC trusted publishing with `--provenance`. A classic `NPM_TOKEN` is used only when `token_fallback` is set. | `npm view thumbgate dist.attestations` |
| Version truth | Right now the site reports 1.42.0, npm latest 1.44.0, main 1.45.0. No check compared all of them before this PR. | `node scripts/check-version-truth.js` |
| Downloads | 2,265 last week (18–24 Nov), 4,179 last 30 days. Not users: see below. | `api.npmjs.org/downloads/point/...` |

## 1. Release cadence

Cause: `publish-npm.yml` runs on every push to main that changes `package.json`, and the repo bumps the version in most PRs (142 of 271 main commits since 11 Nov touched `package.json`). Each bump becomes a `latest` release. The window guard in `scripts/release-window.js` only bounds the opposite problem (shipped content with no bump for more than 7 days).

Proposed rule, for Igor's decision (it changes what users receive):

1. **Batch.** Only a PR labelled as user-visible bumps the version. Docs, tests, site and CI changes ship under the next version that has a user-visible change.
2. **`next` before `latest`.** Publishing goes to `--tag next` first. A packed-install smoke test (`scripts/prove-packaged-runtime.js --package-spec thumbgate@<v>`, which already exists and runs after publish today) runs against `next`. Only a pass moves `latest`.
3. **Cap.** At most one `latest` per day unless the release fixes a regression in the last `latest`.
4. **Moving a dist-tag is a manual step** (`npm dist-tag add thumbgate@<v> latest`) and stays with Igor until the smoke gate has run clean for a month.

Today the order is the reverse: publish to `latest`, then smoke (`publish-npm.yml`, step "Verify published npm runtime smoke"). A failure leaves a bad `latest` that users can install.

## 2. Package health

- Size ratchet: 10,820,000 bytes, current 10,809,198. The next feature will need either a trim or a deliberate raise. Largest directories in the tarball: `scripts` 7.1 MB, `public` 1.6 MB, `src` 0.9 MB, `config` 0.3 MB, `bin` 0.2 MB.
- 727 files includes scripts that run only in this repo (social publishers, revenue, Grafana). Moving repo-only scripts out of `files` is the cheapest size cut, but each removal needs the existing `tests/packed-cli-require-closure.test.js` to stay green (35 missing scripts shipped once, fixed in 1.40.2).
- 761 MB install: `@lancedb/lancedb` pulls `@huggingface/transformers`, which pulls `onnxruntime-node`. If the vector store were an optional dependency loaded on demand, a plain `npx thumbgate init` would skip those 545 MB (not measured without them). This is the largest lever on install time and on the npm "install size" users see. It needs a code owner to confirm which commands need embeddings before changing it; not done here.
- Provenance is already on. Keep the OIDC path and treat `NPM_TOKEN` as emergency-only (the workflow comment says the bypass-2FA token path ends Jan 2027).

## 3. Install path

Command run (no repo files, temp HOME and temp cache, `CI=1`):

```
HOME=$T npm_config_cache=$T/c npx --yes thumbgate@1.44.0 init     # exit 0, 23 s
HOME=$T npm_config_cache=$T/c npx --yes thumbgate@1.44.0 doctor   # exit 0, 1 s
grep -c "Cannot find module" <both logs>                          # 0
```

CI gate already in place: `publish-npm.yml` "Verify published npm runtime smoke" runs `prove-packaged-runtime.js` against the published version, and `tests/packed-cli-require-closure.test.js` runs in `npm test`. The gap is ordering (see section 1), not coverage. No new install test is added here.

## 4. Discoverability (wording proposals only; README homepage text is owned by the site lane)

Current `description`: "ThumbGate Pre-Action Checks self-improve from ranked lessons and repeated failures, hard-block detected secret leaks, and block matches in strict mode." It names no agent and no outcome.

Proposed, narrower than the code (the code blocks matched tool calls; it does not make agents "safe"):

> Local checks that stop AI coding agents (Claude Code, Cursor, Codex) from repeating mistakes: thumbs-down a bad tool call once, and matching calls are warned or denied next time. Runs on your machine.

Other fields as found: `homepage` https://thumbgate.ai, `repository` and `bugs` present, `engines.node >=18.18.0`, 35 keywords, four `bin` names (`thumbgate`, `thumbgate-dashboard`, `thumbgate-revenue-evidence`, `futureagi-bridge`). The last two are repo-internal tools exposed as global commands to every installer; consider dropping them from `bin` (a user-visible change, so it goes through the batching rule). There is no `types` field; the package ships a CLI and an MCP server, not a library, so none is proposed.

## 5. Version truth

`npm run check:version-truth` (new, `scripts/check-version-truth.js`) compares package.json, the git tag on HEAD, the top `CHANGELOG.md` heading, `npm view thumbgate dist-tags.latest` and the live `/health` version. Sources it cannot read print "notChecked", never a match.

- Strict (after a release): every readable source must equal package.json. Run on 25 Nov it fails, correctly: `npmLatest 1.44.0 != package 1.45.0`, `health 1.42.0 != package 1.45.0`.
- `--allow-ahead` (PR mode): npm, tag and /health may trail package.json, never lead it.
- `--offline`: skips npm and /health. `publish-npm.yml` runs `--offline --allow-ahead` in the release safety checks, so the tag, package.json and CHANGELOG cannot drift apart silently.
- Not wired as blocking: the strict form against `/health`, because Railway rebuilds 2–5 minutes after a merge and the last two deploy runs failed. Wire it into `deploy-verify.yml` once the deploy is stable.

## 6. Download numbers

npm counts every tarball fetch: CI runs, mirrors, our own `prove-packaged-runtime` installs (up to 12 retries per release) and scanners. 2,265 a week is an upper bound on installs, not users. To separate real use:

- Subtract our own: each release causes the smoke installs above, plus every CI job that runs `npm ci` from the registry for a published version.
- Compare with first-party telemetry: the hosted API counted 14,405 site visitors in 30 days and 2 checkout starts; a download is not an activation. The meaningful number is `init` runs that reach the telemetry ping (204 on the probe), reported separately from downloads.
- Per-version counts (`api.npmjs.org/versions/thumbgate/last-week`) show whether weight sits on the newest version (real users following `latest`) or on a pinned old one (CI and mirrors).
- Never write "N users" from the npm number.

## Publish path (for Igor, not run here)

1. Merge to main. `publish-npm.yml` currently publishes `latest` itself on a `package.json` change.
2. To adopt the `next`-first rule, change `NPM_TAG` to `next`, add a step after the smoke test that runs `npm dist-tag add thumbgate@<v> latest`, and keep the existing OIDC provenance publish.
3. Nothing in this PR publishes, tags, deprecates or unpublishes.

## Assumptions

- "Last 14 days" counted from 22:00 UTC on 25 Nov.
- Downloads and registry figures are as of the same day and will change.
- The install time is one cold-cache run on Igor's Mac, not a median.
