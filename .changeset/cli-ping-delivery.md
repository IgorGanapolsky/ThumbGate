---
"thumbgate": patch
---

Deliver the `first_block_upsell_shown`, `cli_limit_hit` and `runtime_auto_update` pings from processes that exit right away (hooks, the CLI limit path, the background updater) through a detached or awaited send, so the server receives them. The public activation funnel now also reports upgrade-capable activations and hook-runtime update results.
