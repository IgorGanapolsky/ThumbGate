# Codex Plugin Operations

## What each surface does

- Codex install page: human install and trust-building surface
- Proof-backed setup guide: self-serve activation surface after install intent
- GitHub release bundle: portable plugin distribution surface

## Canonical identity

- Display name: `ThumbGate`
- Plugin slug: `thumbgate`
- npm package: `thumbgate`
- MCP server label inside the plugin config: `thumbgate`

## Update behavior

- Runtime path: the Codex plugin installs or launches `thumbgate@latest` through the local runtime path.
- npm releases: publishing a new npm package can update the runtime that Codex resolves after restart.
- Install page copy: `npm publish` does not update the Codex install page, setup guide, screenshots, or proof-linked operator copy.
- Bundle refresh: the direct zip and the install docs need their own release verification path.

## Release workflow

1. Merge the version bump to `main`; the release workflows publish the npm package and the matching GitHub release asset.
2. Verify the latest package is available with `npm view thumbgate version`.
3. Verify the latest direct bundle is available at `https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-codex-plugin.zip`.
4. Refresh the install page, setup guide, and release-bundle positioning when proof links or offer order change.

## Positioning rules

- Lead with one repeated Codex workflow mistake before architecture.
- Use the install page first when the buyer needs trust, screenshots, or context before download.
- Use the setup guide after the buyer wants the tool path.
- Keep proof near the paid motion by linking [VERIFICATION_EVIDENCE.md](./VERIFICATION_EVIDENCE.md).
- Keep pricing and traction claims aligned with [COMMERCIAL_TRUTH.md](./COMMERCIAL_TRUTH.md).
- Do not claim installs, revenue, or marketplace approval without command evidence.

## Suggested short description

Auto-updating MCP plugin and hook launcher for Codex with Pre-Action Checks, thumbs-up/down feedback memory, and a local-first Reliability Gateway.

## Suggested manual submission fields

- Name: `ThumbGate`
- Install page: `https://thumbgate-production.up.railway.app/codex-plugin`
- Setup guide: `https://thumbgate-production.up.railway.app/guide`
- Direct bundle: `https://github.com/IgorGanapolsky/ThumbGate/releases/latest/download/thumbgate-codex-plugin.zip`
- Repository URL: `https://github.com/IgorGanapolsky/ThumbGate`
- Revenue pack: `node scripts/codex-plugin-revenue-pack.js --write-docs`
