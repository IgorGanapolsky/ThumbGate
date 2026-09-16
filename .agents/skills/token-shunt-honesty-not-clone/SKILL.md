---
name: token-shunt-honesty-not-clone
description: >
  Steal Spotify Portal/shunt FORMAT: PreToolUse blocks untargeted Read above
  350 lines, bare cat of large files, and full-file dumps. Do NOT install
  shunt@portal, buy Portal, or claim 90% savings from GitHub App 162279530.
  Slash: /token-shunt-honesty-not-clone.
---

# Token shunt FORMAT — intercept, don't clone Portal

## Goal

Produce fail-closed bulk-read intercepts for whom: ThumbGate agents — so
untargeted Read/cat of large files never dump into the frontier context, and
Spotify Portal stays a compare-not-clone neighbor, not a SKU or cash rail.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Install `shunt@portal` / `@spotify/portal-cli` | `npx thumbgate token-shunt-honesty --json` |
| Buy Spotify Portal / Contact Sales as "make money" | Local slice (`offset`/`limit`, `cat \| grep`) |
| Claim 90% token savings from App 162279530 | Measure `--lines` + `--returned-lines` |
| Delegate architecture to Flash/Portal/AiKA | Frontier for reasoning; `local_slice` for boilerplate |
| Spam buy links via All-repositories write | ECI: no ThumbGate paid outreach through Portal |

## Reference

- https://github.com/spotify/portal-ai-plugins (Apache-2.0 shunt plugin — we do not vendor it)
- GitHub App install 162279530 = catalog connector, not revenue
- Marketplace (free cite only): https://github.com/marketplace/actions/thumbgate-agent-governance

```bash
npx thumbgate token-shunt-honesty --json --lines=800
npx thumbgate token-shunt-honesty --json --lines=800 --targeted
npx thumbgate token-shunt-honesty --json --clone-portal
```

## Examples (show, don't tell)

Weak: "Install Portal, we will save 90% and make money."

Gold:

```bash
$ npx thumbgate token-shunt-honesty --json --lines=800
{"ok":false,"findings":[{"id":"untargeted_bulk_read"}]}
$ npx thumbgate token-shunt-honesty --json --lines=800 --targeted
{"ok":true}
```

## Procedures

1. Block untargeted Read above 350 lines.
2. Block bare `cat`/`head`/`tail`/`less`/`more` of large files; allow pipes to grep/rg.
3. Block returning the whole file to the frontier model.
4. Refuse Portal/AiKA/Flash for architecture/debug.
5. Treat GitHub App all-repos write as a warn, not a payout.

## Rubric

- `--lines=800` → `untargeted_bulk_read`
- `--targeted` → `ok=true`
- `--clone-portal` → `portal_clone_refused`
- doctor: `npm run test:token-shunt-honesty` PASS
- evidence: command output in the same turn
