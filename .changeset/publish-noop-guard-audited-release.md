'thumbgate': patch
---

Treat pending changesets as an audited no-op path in the npm publish guard so main no longer fails when release-relevant content lands ahead of the next versioned publish.
