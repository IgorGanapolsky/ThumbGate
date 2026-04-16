---
"thumbgate": patch
---

Add gate-coherence analyzer to detect pseudo-unification across enforcement layers. Runs 20 probes across spec-gate and gate-config layers, detects contradictions (one blocks, another allows), coverage gaps (dangerous input passes all layers), and false positives. Reports coherence score and grade (unified/divergent/over-blocking). Inspired by entropy-probing research on pseudo-unification in multimodal models.
