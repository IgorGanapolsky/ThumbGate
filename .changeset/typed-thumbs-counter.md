---
"thumbgate": patch
---

A typed "thumbs down" now raises the status-bar counter every time. A repeat of the same bare text in the same session used to be dropped as a duplicate for five minutes; the duplicate check now compares when the prompts were typed (30 seconds), so only a second delivery of the same prompt is skipped. A capture that is logged but not promoted (lifecycle block or schema failure) now refreshes the counter too.
