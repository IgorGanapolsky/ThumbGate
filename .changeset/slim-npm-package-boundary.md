---
"thumbgate": patch
---

Slim the npm package boundary by moving the package main entrypoint to `src/index.js`, publishing only runtime-required files, and adding tarball budget tests that block public marketing assets, plugin bundles, and social automation from shipping to npm.
