# ThumbGate SemVer Policy

## Public Contract

ThumbGate treats the published npm package, Claude Desktop bundle, Cursor plugin surface, and Codex plugin surface as one public compatibility contract.

That means:

1. `latest` must always be stable.
2. Breaking changes require a major version bump.
3. Beta and release-candidate builds must never overwrite stable installer aliases.

## Release Channels

### Stable

- Version shape: `X.Y.Z`
- npm dist-tag: `latest`
- GitHub release: standard release
- Claude Desktop alias asset: `thumbgate-claude-desktop.mcpb`

### Prerelease

- Version shape: `X.Y.Z-beta.N`, `X.Y.Z-rc.N`
- npm dist-tag: `next`
- GitHub release: prerelease
- Claude Desktop alias asset: `thumbgate-claude-desktop-next.mcpb`

## Versioning Rules

### Major

Use a major bump when changing:

- CLI commands or flags
- MCP server names or config shape
- plugin manifest contracts
- statusline or cache formats that external integrations depend on

### Minor

Use a minor bump for backward-compatible capability additions:

- new tools
- new gates
- new dashboards
- new plugin surfaces that do not break existing installs

### Patch

Use a patch bump for backward-compatible fixes:

- bug fixes
- docs fixes
- packaging fixes
- workflow fixes that do not change public behavior

## Enforcement

- `package.json` is the single source of truth.
- `node scripts/sync-version.js --check` must pass before merge.
- publish flows derive the npm dist-tag from the version string.
- prerelease bundles must not overwrite stable download aliases.
