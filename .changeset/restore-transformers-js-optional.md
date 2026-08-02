---
"thumbgate": patch
---

Restore optional local Transformers.js embeddings (`@huggingface/transformers` + MiniLM) with a secure `sharp` override so `hasLocalTransformerProvider()` can light up without reintroducing the libvips advisory path.
