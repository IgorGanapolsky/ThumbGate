# thumbgate-pretool-gate

A SKILL.md that makes an agent hard-block a secret and a repeated lesson failure before the tool call. Warning and continuing is not the success path.

## What you get

- Install of the public `thumbgate` package at version 1.37.2.
- A deny rule for secret exfiltration.
- A deny rule for a failure that ranked lessons already recorded.
- The feedback command that turns the miss into the next rule.
- A short example of deny versus warn in `examples/deny-and-warn.md`.

## When it activates

Ask the agent to gate a tool call, block a secret, stop a repeat mistake, capture thumbs-down feedback, or install ThumbGate.

## Example

"Block the next command if it would print a secret, and do not continue on a warning."

The agent follows the steps in `SKILL.md` and stops on deny.

## Price

Listed on Agensi at $9 one-time. The creator keeps 70% under Agensi's published fee. Hosted ThumbGate Pro is a separate subscription at https://thumbgate.ai and is not this file.

## Hosts

`https://thumbgate.ai`, `https://www.npmjs.com/package/thumbgate`, `https://github.com/IgorGanapolsky/ThumbGate`.
