---
pretty_name: ThumbGate Agent Feedback Sample
license: mit
task_categories:
  - text-classification
  - reinforcement-learning
tags:
  - agents
  - feedback
  - dpo
  - thumbgate
  - governance
  - pretooluse
size_categories:
  - n<1K
---

# ThumbGate Agent Feedback Sample

**Synthetic / redacted sample** of the ThumbGate feedback to DPO export shape.

This is **not production customer data**. Schema matches:

```bash
npx thumbgate export:hf
```

## Files

- `preferences.jsonl` — chosen/rejected preference pairs (DPO-ready)
- `traces.jsonl` — agent feedback traces (signal + context + outcome)

## Product

- Space: https://huggingface.co/spaces/IgorGanapolsky/ThumbGate
- App: https://thumbgate.ai/?utm_source=huggingface&utm_medium=dataset&utm_campaign=thumbgate_dataset
- GitHub: https://github.com/IgorGanapolsky/ThumbGate

MIT.
