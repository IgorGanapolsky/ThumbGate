---
name: qwenwork-policy-group-honesty-not-clone
description: >
  The 2026-10-28 QwenWork Enterprise Premium note is FORMAT, not a ThumbGate
  product. Steal one org policy group at the action: model catalog, usage
  limit, marketplace installs, trusted devices and networks, sensitive words,
  IM channels, and exportable admin/user/AI audit. Never buy seats, call
  Alibaba Cloud, or install DingTalk, WeCom, or Feishu.
  Slash: /qwenwork-policy-group-honesty-not-clone.
---

# QwenWork policy group — compare, do not clone

## Goal

Decide one org action before it runs. Unlisted models, skills, connectors, expert suites, devices, networks, and IM channels deny.

## Constraints

| NEVER | ALWAYS |
| --- | --- |
| Buy Enterprise Premium seats or a credits pack | `npx thumbgate qwenwork-policy-group --json` |
| Call Alibaba Cloud or open an Alibaba account | Directory slot is entra, ldap, scim, saml, or oidc |
| Install DingTalk, WeCom, or Feishu | Trusted device, trusted network, sensitive word, and IM channel deny when they miss the policy |
| Treat their seat price as a ThumbGate price | Audit class is admin, user, or ai, and the record is exportable |
| Ship a white-label standalone app | Training use is on only when the action is BYOK and `allowByokTraining` is true |

## Procedures

```bash
npx thumbgate qwenwork-policy-group --json --map-only
npx thumbgate qwenwork-policy-group --json --policy=policy.json --action=action.json
npm run test:qwenwork-policy-group
```

`policy.org` is required. An empty allowlist denies that install. `brand.apply` records a branding label. `clone` and `packageApp` deny.
