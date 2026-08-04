---
"thumbgate": patch
---

Stop the money guard from hard-denying ordinary developer commands.

Two independent defects made the guard deny work that cannot spend anything.
Because the hook is registered with a match-everything pattern, this affected
every project on the machine, not just this one.

1. The commerce-path matcher allowed a bare-word alternation, so any payload
   merely CONTAINING one of its tokens anywhere was denied regardless of
   context. Confirmed live: a Python docstring in an unrelated repository was
   rejected as an attempted transaction. Now requires a real path or fragment
   separator, plus a trailing word boundary so a token continuing into a longer
   identifier is not a path.

2. Several tokens appear in BOTH the mutation-action list and the
   financial-object list, so a single word satisfied both halves of the
   conjunction and self-denied — which is why ordinary version-control
   subcommands were blocked before reaching the matcher at all. The action and
   the object must now occupy distinct, non-overlapping spans.

Measured over 234,768 payloads built from every tracked source and document
line, evaluated through the guard's own decision function:

  denies before          8458
  denies after           5229
  loosened               3229   (2730 path matcher, 499 action-and-object)
  tightened                 0
  loosened WITH a vendor host present   0
  action-and-object cases that were a single overlapping token   499 of 499

The second figure is a census, not a sample: every case the span rule changed
was one word proving both halves, which is the defect itself. No payload
carrying a vendor host changed decision, and nothing previously allowed became
denied.

Adds two suites. `spend-guard-path-precision` derives its vectors from the
pattern so it cannot embed the tokens it tests. `spend-guard-hook-contract`
spawns the guard as a real hook process and asserts both the decision and the
stdout transport contract — malformed hook output surfaces to users as an
opaque validation failure indistinguishable from a policy denial. Against the
previous guard the two suites fail 6 of 8.
