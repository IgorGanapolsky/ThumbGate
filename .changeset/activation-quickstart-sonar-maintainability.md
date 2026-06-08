---
"thumbgate": patch
---

chore(activation): clean up `scripts/activation-quickstart.js` maintainability smells flagged by SonarCloud after #2568 merged — use `node:` import specifiers, `String.raw` in the regex escaper, optional chaining for the gate verdict and CLI error, and drop unused catch bindings. Also replaces an always-true assertion in the non-TTY quickstart test with a real check on the printed hint. No behavior change.
