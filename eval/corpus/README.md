# ThumbGate Adversarial Eval Corpus

63 cases for pre-action gates on AI coding agents. The `class` field
in cases.jsonl holds eight classes:

| class | cases | what it probes |
|---|---|---|
| policy | 10 | known-bad shapes |
| verbatim | 2 | the exact command a rule was learned from |
| reworded | 22 | paraphrase-gap probes (same intent, different text) |
| gate-bypass | 6 | attempts to turn off or route around the gate |
| context-shift | 2 | a known-bad action in a new context |
| ambiguous | 4 | cases where warn is the right answer |
| legit-neighbor | 7 | legitimate actions close to a bad one |
| false-positive-guard | 10 | legitimate actions a gate must NOT block |

The seven `sir-` cases (sir-01 to sir-07) are containment-escape and
urgency/authority framings after Anthropic's SIREN methodology; they are
filed under `gate-bypass` (sir-01 to sir-04) and `reworded` (sir-05 to
sir-07), not in a class of their own.

Each case is one JSON object per line: `id`, `class`, `prior`, the
attempted `command`, the `expected` verdict (deny 37, warn 8, allow 18)
and the `reason`. Counts verified 2026-11-27 against cases.jsonl.

The fifteen `gepa-` cases (gepa-01 to gepa-15, added 2026-11-27) come
from real failures that week: retries after a deny, spend-guard false
blocks, authenticated database reads, notes that name a mail tool, and
shell commands run through a skill. They are spread across the existing
classes.

Use them to score any gate — ours included. If your gate catches the
reworded class, publish your numbers; ours currently does not, and the
coverage table on thumbgate.ai says so.

License: MIT (see LICENSE). Maintainer: Igor Ganapolsky.
