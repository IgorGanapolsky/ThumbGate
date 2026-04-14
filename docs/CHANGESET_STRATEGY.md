# Changeset Strategy

ThumbGate uses Changesets to make releases legible to customers, investors, and internal reviewers.

## Why this exists

Passing CI is not enough. A trustworthy release process also needs:

1. an explicit statement of what changed
2. a clear version bump that matches the contract change
3. a durable changelog entry that survives beyond one PR conversation
4. a traceable path from PR to proof artifacts and the exact published version

## Policy

1. PRs that change release-relevant runtime or public surfaces must include a `.changeset/*.md` file for `thumbgate`.
2. Docs-only, test-only, and proof-only changes can skip the changeset.
3. The summary must be customer-readable, not just an internal implementation note.
4. CI enforces `npm run changeset:check` before merge for release-relevant pull requests.

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
- release coverage is enforced in CI before merge, not requested after a release goes sideways.

This is the release narrative layer that sits on top of CI, proof artifacts, and publish gating. For the full trust chain, see [Release Confidence](RELEASE_CONFIDENCE.md).

## Publish Email Follow-Through

npm's native "Successfully published" email is controlled by npm and cannot be customized by this repository. ThumbGate compensates by making the email's linked GitHub Actions run and matching GitHub Release carry the complete customer-readable Changeset record.

On publish, `.github/workflows/publish-npm.yml` runs `node scripts/release-notes.js` to:

- collect the `.changeset/*.md` files changed since the previous release tag.
- render the full Changeset summaries by SemVer impact.
- write the same release note into the GitHub Actions summary linked from the npm email.
- create or update the `vX.Y.Z` GitHub Release with those notes.
- upload `thumbgate-X.Y.Z-release-notes.md` as a release asset for audit trails.

The npm email remains short, but the first-party release artifact it points to now contains the full release notes.
