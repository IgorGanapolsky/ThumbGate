---
"thumbgate": patch
---

fix(sonar): stop S3403 false positives burying the real bugs

SonarCloud reports 176 open BUGs on this project. **147 of them (84%) are one
rule, `javascript:S3403`, firing on the canonical CommonJS entry-point guard:**

```js
if (require.main === module) { ... }
```

Sonar's type model reads `require.main` as `Module|undefined` and `module` as
`NodeModule`, concludes the comparison can never hold, and reports it as a bug.
It does hold — this is the idiom in Node's own documentation, and 169 files in
`scripts/`, `src/` and `bin/` depend on it to decide whether they are being run
directly or required as a library.

Measured live against the SonarCloud API on 2026-08-25:

| | |
|---|---|
| Open BUGs | 176 |
| ...of which `S3403` | **147 (84%)** |
| Files containing `require.main === module` | 169 |

Rewriting 169 entry points to satisfy the rule would change real startup
behaviour across every CLI in order to improve a score. That is the wrong trade.
Excluding the rule is the right one.

**Scope, narrowed after review:** the suppression covers only where the idiom
actually lives — `scripts/**` (168 guard files by grep), `adapters/**` (2), and
`src/api/server.js` (1). `S3403` stays active across the rest of `src/` (the
product core), `bin/`, and `tests/`, so a genuinely always-false `===` there is
still reported. The properties file carries the re-check command so the
exclusion can be revisited rather than trusted forever.

Note the shape of this problem is the same one `src/alert-noise-ledger.js`
addresses on the gate surface: a high-volume, low-precision signal trains
everyone to ignore the channel, and the real findings go with it. Here it was
29 genuine bugs behind 147 false ones.
