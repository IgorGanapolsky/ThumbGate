# ThumbGate Adversarial Eval Corpus

48 cases for pre-action gates on AI coding agents, in five classes:
policy (known-bad shapes), reworded (paraphrase-gap probes), tempter
(urgency/authority/thoroughness framings, after Anthropic's SIREN
methodology), siren (containment-escape attempts), and FP-guard
(legitimate actions a gate must NOT block).

Each case is one JSON object per line in cases.jsonl: the attempted
action, its class, and the expected verdict (deny / warn / allow).
Cases were counted and verified 2026-11-25 (48 lines, 8 siren-class).

Use them to score any gate — ours included. If your gate catches the
reworded class, publish your numbers; ours currently does not, and the
coverage table on thumbgate.ai says so.

License: MIT (see LICENSE). Maintainer: Igor Ganapolsky.
