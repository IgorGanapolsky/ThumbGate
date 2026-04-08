# Changeset Strategy

ThumbGate uses Changesets to make releases legible to customers, investors, and internal reviewers.

## Why this exists

Passing CI is not enough. A trustworthy release process also needs:

1. an explicit statement of what changed
2. a clear version bump that matches the contract change
3. a durable changelog entry that survives beyond one PR conversation

## Policy

1. PRs that change release-relevant runtime or public surfaces must include a `.changeset/*.md` file for `thumbgate`.
2. Docs-only, test-only, and proof-only changes can skip the changeset.
3. The summary must be customer-readable, not just an internal implementation note.

Release-relevant surfaces include:

- `src/`
- `scripts/`
- `adapters/`
- `public/`
- `config/`
- `plugins/`
- package manifests and `README.md`

## Workflow

1. Create the release note:

```bash
npm run changeset
```

2. Validate the PR against the current base branch:

```bash
npm run changeset:check
```

3. When it is time to cut the next release, consume all pending changesets:

```bash
npm run changeset:version
```

That command updates the root version, generates or updates `CHANGELOG.md`, and then runs ThumbGate's version-sync step so the adapter and plugin manifests stay aligned.

## Why buyers should care

- `latest` stays reserved for stable releases.
- contract changes are visible before publish, not reverse-engineered after an incident.
- every shipped version has a written explanation, not just a Git diff.
- release notes map back to the PRs and checks that justified the change.

This is the release narrative layer that sits on top of CI, proof artifacts, and publish gating.
