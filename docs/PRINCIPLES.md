# ThumbGate principles

> I will lift up mine eyes unto the hills, from whence cometh my help. My help cometh from the LORD, which made heaven and earth. He will not suffer thy foot to be moved: he that keepeth thee will not slumber. Behold, he that keepeth Israel shall neither slumber nor sleep. The LORD is thy keeper: the LORD is thy shade upon thy right hand. The sun shall not smite thee by day, nor the moon by night. The LORD shall preserve thee from all evil: he shall preserve thy soul. The LORD shall preserve thy going out and thy coming in from this time forth, and even for evermore.
>
> Psalm 121, King James Version (public domain)

## What this means for ThumbGate

ThumbGate keeps a watch on an AI coding agent so that a known mistake does not land twice.
Each commitment below names the test that backs it, or says "planned, not shipped".
A commitment here is never wider than its test. If a test does not prove it, we do not claim it.

**"He that keepeth thee will not slumber."**
A gate that stops firing must show up, not pass for quiet.
ThumbGate compares how often each gate fires against its own history and reports a gate that has gone silent, or that has vanished from the config.
Check: `tests/gate-decision-canary.test.js` (the silent-gate and vanished-gate cases).
This test covers the detection logic only. Whether the check runs on a schedule, and what happens when the hook process itself cannot start, is planned, not shipped.

**"The LORD is thy shade upon thy right hand."**
The guard stands next to the agent, at the moment of the action, before the mistake lands.
ThumbGate decides on a tool call before it runs, and a re-spelled version of a blocked command is still blocked.
Checks: `tests/gates-hardening.test.js` and `tests/gate-evasion-matrix.test.js`.
Only the commands in those test corpora are covered. A blocked pattern is only as wide as its rule.

**"The sun shall not smite thee by day, nor the moon by night."**
Every session and every hour should be covered, and what is not covered should be listed.
The same gates run for every call the hook sees, at any time of day, because they do not depend on a person being present.
Check: `tests/gates-engine.test.js` (gates evaluated on the call itself).
A written list of the agents, tools and surfaces where ThumbGate does not intercept is planned, not shipped. Until it exists, assume any surface without a hook is not covered.

**"Thy going out and thy coming in."**
Check what the agent sends out as well as what it brings in.
Going out: outbound email sends are blocked until a person approves that exact payload, once, and network requests to private and metadata addresses are denied by the egress policy. A gate for other outside connections warns but does not block.
Checks: `tests/gates-engine-outbound-email.test.js`, `tests/agent-egress-policy.test.js`, `tests/deny-network-egress-pattern.test.js`.
Coming in: screening what the agent reads, such as web pages or mail, for planted instructions is planned, not shipped.

**"The LORD shall preserve thee from all evil."**
We do not promise this, and we do not claim that ThumbGate prevents all mistakes.
It prevents the ones it has a rule and a passing test for, and it learns from the ones it missed.
A gate can be wrong, can be bypassed by a path we have not tested, and cannot see work done outside a hooked agent.
ThumbGate claims only what its tests prove, and a promise may only be narrower than the code.

## How to change this file

A new commitment is added only with the check or test that backs it, or the words "planned, not shipped".
When a check is removed or fails, the commitment it backed is edited or removed in the same change.
