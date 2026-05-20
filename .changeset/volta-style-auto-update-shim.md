---
"thumbgate": minor
---

Adds Volta-style auto-update shim at `~/.thumbgate/bin/thumbgate-hook`. Hook commands now resolve through a stable shim that always runs `thumbgate@latest`, surviving across version bumps without re-wiring Claude settings. Fast path uses cached runtime binary; slow path falls back to `npx --yes thumbgate@latest`.
