---
"thumbgate": patch
---

Activated users now get a clickable, one-click path to checkout: the first-block upgrade line links straight to `https://thumbgate.ai/checkout/pro` (with the gate name in `utm_content`) instead of an unclickable `thumbgate.ai/pricing` text. The CLI's capture-limit link goes through `thumbgate.ai/go/pro` like every other upgrade link, instead of a raw Stripe payment link. New `first_block_upsell_shown` and `cli_limit_hit` pings and an `activationFunnel` block on `/v1/metrics/real` make activated → shown → checkout measurable. The public activation count now counts the `first_block` event production CLIs actually send (it read 0 while 109 had happened), and a rejected stored key no longer loses the activation or retries on every gate firing.

`thumbgate self-update` now also updates the cached hook runtime in `~/.thumbgate/runtime`, which is what hooks actually run; before, hooks stayed on the first version ever installed. The MCP server notices an older hook runtime, mentions the update command once in its instructions, and sends one `runtime_version_skew` ping a day. Nothing is installed automatically.
