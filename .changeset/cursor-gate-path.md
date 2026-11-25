---
"thumbgate": patch
---

Cursor: the plugin now runs the ThumbGate check on every shell command instead of only a few keywords (so `aws s3 rm`, `terraform destroy` and `kubectl delete` are no longer skipped), answers in the shape Cursor expects through the new `thumbgate cursor-gate` command, and captures a typed thumbs-down through `thumbgate cursor-prompt` so two thumbs-downs on one command become a gate. The Cursor adapter script now ships in the npm package.
