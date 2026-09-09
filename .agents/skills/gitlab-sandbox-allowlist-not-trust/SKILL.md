---
name: gitlab-sandbox-allowlist-not-trust
description: >
  GitLab 2026-09 FORMAT steal: sandbox allowlists are hops, not trust
  boundaries. Audit package-registry/proxy/HF destinations and trust-handoff
  writes on existing ThumbGate egress rails. Never clone GitLab Duo.
  Slash: /gitlab-sandbox-allowlist-not-trust.
---

# GitLab sandbox allowlist ≠ trust

## Goal

Produce fail-closed honesty for whom: ThumbGate agents treating
`deny-network-egress` / `agent-egress-policy` allowlists as sandbox
containment — so a permitted package proxy cannot silently become the
escape hop GitLab documented.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Clone GitLab Duo Agent Platform / execution sandbox SKU | Classify registry/proxy/HF hosts as `bridge` |
| Treat allowlisted `registry.npmjs.org` as trusted | Independent auth before credentials ride a hop |
| Auto-promote observed proxy traffic onto `allowHosts` | Put bridge hosts on `bridgeHosts` only |
| Claim hook/CI/MCP writes are sandbox-contained | Call them trust-handoff |
| Dual-edit untracked `scripts/gitlab-ai-sandbox-integration.js` | Use this doctor + existing egress policy |
| Hero Continuity / net-new governance SKU | Map onto PreToolUse + `agent-egress-policy` |

HARD fail closed. REFUSE SKU clones. ECI: maintenance of existing egress rails only.

## Reference

- https://www.infoq.com/news/2026/09/gitlab-ai-sandbox-access/
- https://about.gitlab.com/blog/ai-agent-sandbox/
- `scripts/allowlist-bridge-honesty.js`
- `scripts/agent-egress-policy.js` (`STATIC_ALLOW_BRIDGE`, `ALLOWLIST_BRIDGE_CREDENTIAL`)
- `THREAT_MODEL.md` policy-vs-containment
- `/high-roi-steal-and-finish` · `/eci-thumbgate-ip-wall`

## Examples (show, don't tell)

Weak: Summarize GitLab Duo and add a container sandbox class.

Gold:

```bash
$ npx thumbgate@1.36.1 allowlist-bridge-honesty --json
allowlistIsTrustBoundary: false
$ node --test tests/allowlist-bridge-honesty.test.js
# Authorization to registry.npmjs.org → ALLOWLIST_BRIDGE_CREDENTIAL deny
```

## Procedures

```bash
npx thumbgate@1.36.1 allowlist-bridge-honesty --json
npx thumbgate@1.36.1 allowlist-bridge-honesty --allow-hosts=registry.npmjs.org --treat-allowlist-as-trust --json
npx thumbgate@1.36.1 allowlist-bridge-honesty --write=.github/workflows/ci.yml --claimed-contained --json
npm run test:allowlist-bridge-honesty
```

1. Classify every allowlisted host (`bridge` vs `public` vs `ssrf_private`).
2. Deny credentialed requests to bridge hops unless `independentAuth` is already granted.
3. Keep observe→draft from promoting package proxies onto `allowHosts`.
4. Label privileged-consumer writes as trust-handoff.
5. Refuse `--clone-gitlab-duo`.

## Rubric

- gold fixture (this repo default gate) → `ok=true`, `allowlistIsTrustBoundary=false`
- `--treat-allowlist-as-trust` with npm registry → `ok=false`
- `--clone-gitlab-duo` → `ok=false`
- observe draft of `registry.npmjs.org` → not in `allowHosts`
- Authorization to allowlisted npm → `ALLOWLIST_BRIDGE_CREDENTIAL`
- doctor: `npm run test:allowlist-bridge-honesty` PASS
- evidence: command output in the same turn
