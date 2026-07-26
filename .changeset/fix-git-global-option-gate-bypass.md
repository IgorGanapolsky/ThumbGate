---
"thumbgate": patch
---

Close command-position gate bypasses

The catastrophic gate patterns anchor the command position as `(?:^|[;&|]\s*)` — the command
must sit at the very start of the string or immediately after `;`, `&` or `|`. That anchor
exists to avoid matching a command merely mentioned inside a quoted string, but it is far too
narrow. It does not recognise a command on a **new line**, nor any ordinary way a binary gets
invoked. Separately, git accepts global options between `git` and the subcommand, which
defeated the patterns from the other direction.

Verified against unmodified `main` — every form below matched **no gate at all**, while the
plain form denied:

| evaded form | before | after |
|---|---|---|
| `git -C <dir> reset --hard HEAD~5` | no gate matched | deny |
| `git -c core.pager=cat clean -fd` | no gate matched | deny |
| `sudo git reset --hard HEAD~5` | no gate matched | deny |
| `GIT_DIR=… git reset --hard HEAD~5` | no gate matched | deny |
| `/usr/bin/git reset --hard HEAD~5` | no gate matched | deny |
| `command git reset --hard HEAD~5` | no gate matched | deny |
| `"git" reset --hard HEAD~5` | no gate matched | deny |
| `\git reset --hard HEAD~5` | no gate matched | deny |
| `echo hi⏎git reset --hard HEAD~5` | no gate matched | deny |
| `nohup time git clean -fd` | no gate matched | deny |

The same anchor guards `rm-rf-home-or-root`, so the identical evasion applied there:

| evaded form | before | after |
|---|---|---|
| `sudo rm -rf ~` | no gate matched | deny |
| `sudo rm -rf /` | no gate matched | deny |
| `/bin/rm -rf ~` | no gate matched | deny |
| `echo hi⏎rm -rf ~` | no gate matched | deny |
| `env FOO=1 rm -rf $HOME` | no gate matched | deny |

That is **all four** `CATASTROPHIC_DECLARATIVE_GATE_IDS` — the set this engine documents as
effectively irreversible and exempts from the free-tier daily-cap discount "regardless of
tier or strict-mode setting". Each was evadable with a one-token prefix.

Precision is preserved: `rm -rf node_modules`, `rm -rf build/` and
`sudo rm -rf /tmp/scratch-dir` remain allowed, because the gate still targets only home and
root.

The same gap made `extractAffectedFiles()` return an empty list for the git-global-option
forms, which silently disarmed `task-scope-required` and `protected-file-approval-required`
as well: a gate that evaluates no files raises no violation.

Rather than complicate every gate regex, the command is canonicalized before matching —
separators (including newlines) are normalised, env-assignment prefixes and wrapper binaries
(`sudo`, `command`, `env`, `nohup`, `time`, …) are stripped, directory and quoting on the
binary token are removed, and git global options are dropped. Patterns are tested against the
**original text and the canonical form**, so this can only ever add a match, never remove one.

Confirmed no new false positives: `echo "git reset --hard is dangerous"`,
`grep -r "git clean -fd" docs/`, `sudo ls /var/log`, `git status`, `git diff` and the rest of
the benign set behave exactly as they do on `main`.

**Known residual:** resolving the binary through a subshell (`$(which git) reset --hard`)
still evades. Canonicalization is static and cannot resolve a subshell without executing it;
closing that needs exec-time gating rather than pattern matching. Recorded as an explicit
test so it stays a known limit rather than a silent gap.

**Second anchor bug, found by measuring instead of reasoning:** `local-only-git-writes`,
`task-scope-required`, `branch-governance-required` and `release-readiness-required` anchor
with a **bare `^`**, which matches only the first command in the string — not even after `;`.
So `echo hi && git commit -m x` was skipped while `git commit -m x` denied, and chaining is
how agents normally work. Each gate is now offered every canonicalized segment as its own
match candidate.

Measured over a corpus of gated commands crossed with nine ways of re-spelling them
(sudo, env prefix, `&&`/`;`/newline chaining, absolute binary path, quoting, backslash, git
global option): **62 evasion holes on unmodified `main`, 0 after this change.** That grid is
now `tests/gate-evasion-matrix.test.js` so it cannot silently regress.
