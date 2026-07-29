---
thumbgate: minor
---

Task scopes can now take a lease. `set_task_scope` accepts `ttlMs`, giving capability-scoped
authority a deadline ("write under ./src for 90 seconds") instead of a standing grant that
never says when it stops. Expiry fails closed: a lapsed lease authorises nothing rather than
silently removing the boundary, and the lapsed scope stays visible so "your lease expired" is
distinguishable from "no scope was declared". Scopes declared without `ttlMs` remain permanent,
so existing behaviour is unchanged.
