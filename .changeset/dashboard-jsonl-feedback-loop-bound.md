---
"thumbgate": patch
---

Close the remaining prod dashboard_data 503 path: feedback-loop readJSONL no longer full-readFileSyncs before applying maxLines (diagnostic/memory tails during analyzeFeedback). readTextTail refuses full reads past the hard ceiling even when maxBytes is oversized.
