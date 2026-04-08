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
- release-relevant PRs must include a `.changeset/*.md` entry for `thumbgate`.
- `npm run changeset:check` is enforced in CI for pull requests and merge-group runs.
- `npm run changeset:version` consumes pending changesets into `package.json`, `CHANGELOG.md`, and the synced adapter manifests.
- `node scripts/sync-version.js --check` must pass before merge.
- publish flows derive the npm dist-tag from the version string.
- prerelease bundles must not overwrite stable download aliases.

## Changeset Workflow

1. Add a changeset file with `npm run changeset` whenever a PR touches release-relevant runtime or public surfaces.
2. Use `patch`, `minor`, or `major` based on the public contract above.
3. Keep the summary customer-readable: what changed, why it matters, and whether upgrades require attention.
4. Before cutting a release, run `npm run changeset:version` so the version bump and changelog are generated before the normal publish pipeline runs.

The point is not just SemVer compliance. It is release traceability: investors, customers, and internal reviewers can see what changed, why the version moved, and which PR introduced the contract shift.
