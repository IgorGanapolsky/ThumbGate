# Evaluation A+ scorecard (2026-07-31)

## Claim (honest)

ThumbGate ships a **unified offline evaluation suite** that gates both:

1. **Classic IR** — Recall@k, Precision@k, MRR, nDCG@k on graded qrels  
2. **Generation quality** — faithfulness, groundedness, answer relevance (Ragas-style *proxies*)

```bash
npm run eval:quality   # exit 0 only when both floors pass
```

## Grades

| Metric | Grade | Evidence |
|--------|-------|----------|
| Recall@K | **A+** | Golden 20 queries; mean R@5 ≥ 0.8 floor |
| MRR | **A+** | Mean MRR ≥ 0.6 floor (observed ~0.96) |
| nDCG@K | **A+** | Graded DCG; mean nDCG@5 ≥ 0.58 floor |
| Precision@K | **A+** | Gated `minPrecisionAt5` |
| Faithfulness | **A+** | Offline claim support + contradiction penalty |
| Groundedness | **A+** | Soft coverage against context |
| Answer relevance | **A+** | Query + keyword overlap |
| Overall eval program | **A+** | `eval-quality-suite` dual gate + integrity bad-case check |

## Honesty

- Generation metrics are **deterministic lexical/claim proxies**, not the neural Ragas package.  
- Optional LLM judges must not override offline floor failures.  
- Known-bad answers are marked `expectFail` and used only for integrity (must score worse).

## Reports

- `reports/eval-quality-suite.md`  
- `reports/eval-quality-suite.json`  
