# Changesets

ThumbGate uses Changesets for customer-visible release planning and auditable versioning.

Rules:

1. Any PR that changes release-relevant runtime or public surfaces must add a `.changeset/*.md` file.
2. Use `npm run changeset` to create the entry.
3. Use `npm run changeset:check` to verify release-relevant PR coverage before merge.
4. Use `npm run changeset:version` to consume pending entries into `package.json`, `CHANGELOG.md`, and the version-synced manifests.
5. The publish workflow still runs behind the existing main-branch release checks.
