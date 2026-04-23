# Cursor Plugin Operations

## What each surface does

- Cursor Marketplace: install and metadata distribution surface
- Team Marketplace: private repo-backed install surface for Cursor Teams and Enterprise
- Cursor Directory: discoverability surface only

## Canonical identity

- Display name: `ThumbGate`
- Plugin slug: `thumbgate`
- npm package: `thumbgate`
- MCP server label inside the plugin config: `thumbgate`

## Update behavior

- Runtime path: the Cursor plugin launches `npx -y thumbgate@latest serve`.
- npm releases: publishing a new npm package can update the runtime that Cursor installs or launches.
- Marketplace metadata: `npm publish` does not update the listing description, screenshots, README copy, or directory profile.
- Team refresh: if a Team Marketplace is repo-backed, enable Auto Refresh when the admin UI exposes it.

## Release workflow

1. Merge the version bump to `main`; `publish-npm.yml` auto-publishes unpublished versions and creates the matching `vX.Y.Z` GitHub Release.
2. Verify the latest package is available with `npm view thumbgate version`.
3. Bump plugin manifests when plugin copy, assets, or packaging changed.
4. Refresh the public Marketplace submission or Team Marketplace repo when metadata changed.
5. Refresh Cursor Directory copy separately when the positioning changes.

## Positioning rules

- Lead with the user problem: known mistakes repeating in agent workflows.
- Lead with outcome before architecture: Pre-Action Checks, prevention rules, proof.
- Mention history-aware lesson distillation when the surface allows a vague thumbs signal to become a concrete lesson.
- Keep `DPO` and `Thompson Sampling` in the body or tags, not the first sentence.
- Keep proof near the pitch by linking [VERIFICATION_EVIDENCE.md](./VERIFICATION_EVIDENCE.md).
- In manual forms, use the display name for `Name` and keep the slug for package/config paths only.

## Suggested short description

👍👎 Thumbs down a mistake — your AI agent won't repeat it. Thumbs up good work — it remembers the pattern.

## Suggested long description

👍👎 Thumbs down a mistake — your AI agent won't repeat it. Thumbs up good work — it remembers the pattern.

When the feedback is a vague thumbs-down, ThumbGate can distill the lesson from up to 8 prior recorded entries and the failed tool call, then keep a linked 60-second follow-up session open for later clarification.

## Suggested manual submission fields

- Name: `ThumbGate`
- Description: `👍👎 Thumbs down a mistake — your AI agent won't repeat it. Thumbs up good work — it remembers the pattern.`
- Repository URL: `https://github.com/IgorGanapolsky/ThumbGate`
- Homepage: `https://thumbgate-production.up.railway.app`
