---
"thumbgate": patch
---

fix(governance): use the path-based main check in the Simatree governance CLI

The Simatree governance CLI shipped its entry guard as the `require.main` strict-equality form, which SonarCloud flags as rule `javascript:S3403` (MAJOR) — an always-false comparison under strict type inference.

Replaced with the path-resolve form this repo already standardises on, wrapped in an `isDirectInvocation()` helper that canonicalises both sides with `fs.realpathSync` before comparing.

The realpath step matters. When the CLI is launched through a symlink — an npm `bin` shim, a global install, `npx` — Node leaves `process.argv[1]` as the symlink path while `__filename` is already the realpath of the target. A bare resolve-and-compare is false in that case, and the process would exit 0 having printed nothing: no `--doctor` report, no `--eval` result, no `--sql` verdict. `require.main === module` did not have that hole because Node's module resolution canonicalises first, so the replacement must not open one. Each side falls back to its resolved path if `realpathSync` throws.

Two regression tests pin the behaviour: `require()` returns the exports and prints nothing even when `process.argv` carries `--doctor`, and the CLI still emits its doctor report when invoked through a symlink. Direct `--doctor`, `--eval` and `--sql` invocation is unchanged.
