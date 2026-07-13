Most AI-agent safety systems are comfortable detecting risk. The harder problem is deciding when human feedback is specific enough to become enforcement, then proving that the new rule will not block legitimate work.

ThumbGate 1.28.0 focuses on that boundary.

## Guided first-rule activation

The new interactive quickstart walks an operator through installing a first prevention rule:

```bash
npx thumbgate@1.28.0 quickstart
```

The flow is TTY-aware. In non-interactive environments it prints guidance rather than pretending an operator approved a rule.

Five explicit commands make the operational surface easier to inspect:

- `/thumbgate-guard` turns a concrete mistake into a prevention rule.
- `/thumbgate-rules` shows active rules and learned lessons.
- `/thumbgate-blocked` reports what enforcement actually stopped.
- `/thumbgate-protect` shows branch and release governance.
- `/thumbgate-doctor` checks hook, MCP, and agent-readiness wiring.

## Explicit feedback, explicit enforcement

A bare thumbs-down is evidence, not a permanent policy decision. In 1.28.0, a thumbs-down followed by a concrete `never ...` correction can take the immediate force-gate path. It is surfaced to the operator rather than silently installed.

Thumbs-up guidance remains guidance. An `always ...` preference does not automatically become a hard block because positive preferences rarely define a safe denial boundary on their own.

That distinction is deliberate: fast enforcement for explicit negative constraints, without turning vague sentiment into a lockout.

## Regression-gated rule promotion

Before a candidate prevention rule hardens, ThumbGate replays it against previously allowed actions. A candidate that would catch known-good work is quarantined to warning mode instead of promoted.

This makes rule promotion testable. The question is not only "does this match the failure?" but also "what legitimate behavior would this rule break?"

## Safer unattended operation

For autonomous loops, setting `THUMBGATE_AUTONOMOUS=1` makes approval gates fail closed when no human is present to answer. The release also strengthens self-protection around environment overrides and process-kill attempts.

The goal is not to claim that every risky action is universally blocked. It is to make the active enforcement posture visible, preserve explicit owner escape paths, and prevent an unattended agent from treating silence as approval.

## More runtimes, stronger release proof

Version 1.28.0 adds a Hermes Agent adapter and hardens package-integrity checks so dynamically loaded runtime files are verified before publication. Release checks now validate the package users actually install, not only the source tree that produced it.

## Try it

ThumbGate is MIT-licensed and published on npm:

```bash
npx thumbgate@1.28.0 quickstart
```

- [Release notes](https://github.com/IgorGanapolsky/ThumbGate/releases/tag/v1.28.0)
- [Source](https://github.com/IgorGanapolsky/ThumbGate)
- [Product site](https://thumbgate.ai)

Disclosure: I built ThumbGate. Technical criticism of the feedback, promotion, and lockout tradeoffs is welcome.
