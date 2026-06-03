# ThumbGate Feedback-to-Rules Review Instructions

Use Gitar findings as a source of ThumbGate lessons, but do not assume every finding should become a gate.

## Promote to ThumbGate Lessons When

- The same class of review finding appears in more than one PR.
- The finding identifies a pre-action failure pattern, such as publishing before checking CI, writing secrets outside the vault, editing generated package surfaces without package parity, or claiming deployment without live proof.
- The fix includes an observable before/after outcome: tests failed then passed, route returned 404 then 200, package omitted file then included it, or gate blocked then allowed after scoped remediation.

## Do Not Promote When

- The finding is only stylistic.
- The finding depends on undocumented reviewer preference.
- The finding cannot be expressed as a pre-action check.
- The finding would block safe local credential hardening, such as `chmod 600` on credential files.

## Review Expectations

When a Gitar comment identifies a repeatable failure, suggest a ThumbGate lesson payload:

```text
thumbs down: <one concrete failure>
what to change: <pre-action check that would have prevented it>
evidence: <test, CI, diff, command, or URL>
```

When a PR fixes a recurring finding, suggest an action receipt:

```text
thumbs up: <fix that worked>
what worked: <evidence that the old failure no longer reproduces>
```

