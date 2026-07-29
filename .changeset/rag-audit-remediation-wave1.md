---
thumbgate: patch
---

RAG audit remediation, wave 1. Feedback now derives `lastAction` (tool + sanitized
command) from the audit trail at capture time — the attribution field existed since #203
and was populated 0 times in 1,793 entries, which is why no retrieval golden set could be
built; labels now accrue from live use. Fixes the reranker expansion bug where substring
matching made 'format' inject delete/remove/destroy terms; makes embedder availability
honest (the feature-hash fallback no longer counts, per the module's own contract) and
declares @huggingface/transformers as an optionalDependency so clean installs keep the
local dense leg; binds the embedding cache to vector dimensionality; closes the symlink
escape in both document-import path guards; and stops the 201st document import from
silently evicting older catalog entries. Corrects the retrieval latency figures at their
source (realistic lessons: ~180-226 ms at 5k entries; the hot-path ceiling is process
spawn, ~0.46 s warm / 1.29 s cold).
