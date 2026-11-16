---
"thumbgate": patch
---

CI and the npm publish workflow now fail when a pinned `thumbgate@x.y.z` on the site, in the plugins, adapters, server cards, docs or README is not a version that exists on npm. `npm run check:npm-versions` runs the same check and lists the file and line of each unpublished pin. On pull requests, package.json's own version is accepted only while it is an unreleased bump; after `npm publish` the check runs with no allowance.
