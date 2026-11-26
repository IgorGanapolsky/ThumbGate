# ThumbGate Adversarial Eval Corpus

48 cases for pre-action gates on AI coding agents. The `class` field
in cases.jsonl holds eight classes:

| class | cases | what it probes |
|---|---|---|
| policy | 8 | known-bad shapes |
| verbatim | 2 | the exact command a rule was learned from |
| reworded | 18 | paraphrase-gap probes (same intent, different text) |
| gate-bypass | 4 | attempts to turn off or route around the gate |
| context-shift | 2 | a known-bad action in a new context |
| ambiguous | 2 | cases where warn is the right answer |
| legit-neighbor | 7 | legitimate actions close to a bad one |
| false-positive-guard | 5 | legitimate actions a gate must NOT block |

The seven `sir-` cases (sir-01 to sir-07) are containment-escape and
urgency/authority framings after Anthropic's SIREN methodology; they are
filed under `gate-bypass` (sir-01 to sir-04) and `reworded` (sir-05 to
sir-07), not in a class of their own.

Each case is one JSON object per line: `id`, `class`, `prior`, the
attempted `command`, the `expected` verdict (deny 29, warn 6, allow 13)
and the `reason`. Counts verified 2026-11-26 against cases.jsonl.

Use them to score any gate — ours included. If your gate catches the
reworded class, publish your numbers; ours currently does not, and the
coverage table on thumbgate.ai says so.

License: MIT (see LICENSE). Maintainer: Igor Ganapolsky.
