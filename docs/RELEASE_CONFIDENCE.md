# Release Confidence

ThumbGate treats package publishing as an enterprise trust surface, not a clerical step.

Customers, investors, and internal reviewers should be able to inspect why a version changed, what checks ran, and which proof artifacts justify the release. This document is the shortest path through that trust chain.

## What every release must prove

1. **Written change intent:** release-relevant PRs add a `.changeset/*.md` entry for `thumbgate`, so the change is described before publish instead of reverse-engineered after the fact.
2. **SemVer discipline:** the version bump must match the public contract change according to [SemVer Policy](SEMVER_POLICY.md).
3. **Version-sync:** `node scripts/sync-version.js --check` keeps `package.json`, `CHANGELOG.md`, plugin manifests, and installer metadata aligned.
4. **Verification depth:** the full required suite runs before close-out:
   - `npm test`
   - `npm run test:coverage`
   - `npm run prove:adapters`
   - `npm run prove:automation`
   - `npm run self-heal:check`
5. **Exact merge proof:** the work is not considered complete until the exact `main` merge commit is verified and its evidence is cited.

## What buyers can inspect

- [Changeset Strategy](CHANGESET_STRATEGY.md)
- [SemVer Policy](SEMVER_POLICY.md)
- [Verification Evidence](VERIFICATION_EVIDENCE.md)
- [CHANGELOG.md](../CHANGELOG.md)
- [CI workflow](../.github/workflows/ci.yml)

These are the public surfaces that explain what changed, why it changed, and what was verified.

## Why this matters commercially

- A buyer can inspect a version bump without reading raw diffs.
- An investor can see that package releases are governed by durable process, not ad hoc pushes.
- A platform team can map a release note to its proof artifacts and merge checks.
- A future incident review can reconstruct the decision path from PR, to version, to proof, to publish.

## Operating rule

Passing CI alone is not the whole story. ThumbGate pairs Changesets, SemVer, sync checks, proof artifacts, and exact-merge verification so new package releases stay legible under scrutiny.
