# Release rollback

What to do when a published `thumbgate` release turns out to be bad.

Written because the release pipeline had a solid *forward* path (provenance, immutable tags,
reproducible notes) and no documented way back.

## Why this matters more than for a normal package

Agent machines resolve ThumbGate through `npm exec --package thumbgate@latest` in their
`.mcp.json`. A published release reaches every machine on the next MCP start — there is no
per-machine pin to slow it down.

The failure mode is also quiet. ThumbGate decides whether tool calls are blocked, so a
regression does not crash: it **over-blocks** (agents stall on legitimate work) or
**under-blocks** (a gate silently stops firing). Neither shows up as an error. Assume you will
learn about it from behaviour, not from a stack trace.

## The one lever that actually rolls back

npm versions are immutable, and unpublishing is not available after 72 hours. Do not plan
around `npm unpublish`.

The real lever is the **dist-tag**, because that is what `@latest` resolves:

```sh
# Point latest back at a known-good version
npm dist-tag add thumbgate@<known-good-version> latest

# Confirm
npm view thumbgate dist-tags
```

Agents pick this up on their next resolution. Nothing needs to be republished.

Optionally warn anyone who pinned the bad version explicitly:

```sh
npm deprecate thumbgate@<bad-version> "Regression in <area>; use <known-good-version>."
```

## Procedure

1. **Record the anchor before releasing.** The current `latest` is the rollback target. Put
   the number in the release notes so it is available at the moment it is needed, not looked
   up under pressure.
2. **Roll the tag back** with `npm dist-tag add` (above). Do this first — it stops the spread.
3. **Verify** with `npm view thumbgate dist-tags` and, on a machine that uses it, remove the
   cached runtime so the next start re-resolves:
   `rm -rf ~/.thumbgate/runtime/node_modules`.
4. **Then** fix forward: land the fix, bump, publish a new version, move `latest` onto it.

## Reducing the need for step 2

For a release that changes **enforcement behaviour** — anything that widens or narrows what
gets blocked — prefer a staged rollout:

```sh
# Publish without moving latest
npm publish --tag next --provenance

# Pin one machine to it and let it run against real traffic
npm exec --package thumbgate@next -- thumbgate serve

# Promote only after that machine looks right
npm dist-tag add thumbgate@<version> latest
```

Enforcement changes are the ones worth staging. A copy tweak or a docs change is not.

## What to check before promoting

Because the failure modes are quiet, check behaviour rather than absence of errors:

- `thumbgate gate-stats` — compare blocked/warned ratios against the previous period. A large
  swing in either direction is the signal.
- Confirm a known-good command is still allowed and a known-bad one is still denied. The
  suites in `tests/git-global-option-bypass.test.js` document the pairs worth spot-checking.

## Known gaps

- There is no automated promotion or rollback — both steps above are manual.
- There is no canary that compares gate-decision distributions between versions. Until there
  is, staged rollout plus a manual `gate-stats` comparison is the available control.
