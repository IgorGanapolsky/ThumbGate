---
"thumbgate": minor
---

feat(feedback-stats): emit structured `actionableRemediations` alongside prose `recommendations`

`analyzeFeedback()` / `feedback_stats` now returns a machine-actionable `actionableRemediations` array parallel to the existing prose `recommendations` list. Each entry has:

```ts
{
  type: 'skill-improve' | 'pattern-reuse' | 'trend-declining' | 'trend-degrading' | 'high-risk-domain' | 'high-risk-tag' | 'delegation-reduce' | 'delegation-policy-review' | 'diagnose-failure-category',
  target: string,         // skill name, tag, domain, or failure category
  evidence: { ... },      // numeric signal (counts, rates) that triggered the rule
  action: string,         // canonical action verb consumers can switch on
  rationale: string,      // human-readable explanation of why this fired
}
```

This lets hooks and agents act on recommendations programmatically without regex-parsing prose strings. Prose output is unchanged and fully backwards-compatible; the new field is always present (empty array when no recommendations fire).
