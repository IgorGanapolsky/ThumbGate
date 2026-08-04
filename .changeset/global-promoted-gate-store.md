---
"thumbgate": patch
---

Make learned gates apply in every repository, not only the one that recorded the failure.

The promoted-gate store resolved to exactly ONE location — repo-local when present,
otherwise a per-project directory under the home directory — so a gate promoted from a
failure in repo A was invisible in repo B.

Measured on one machine, same engine, same moment, only the working directory differing:

  cwd=ThumbGate -> 45 promoted gates
  cwd=Resume    ->  4 promoted gates

The 41 missing gates included every one promoted from an outbound-send failure, and an
agent then sent outbound mail from the repository that could not see them. The gate that
should have caught it showed lastFiredAt=null because it was never in scope there.

Loading now unions the global store, every per-project store, and any repo-local store,
deduplicated by gate id with repo-local winning a collision. After the change:

  ThumbGate 45 -> 92    Resume 4 -> 47    trading -> 52    unrelated dir -> 47

Behaviour verified, not assumed. Of the 43 gates newly visible in the affected repository,
40 match nothing in a 51,356-line corpus and the remaining 3 are warn-level, so no new
denial is introduced. Existing gate suites stay green at 89/89, and a mutation that makes
the union return nothing fails exactly one of them.

Note on the subtlety, because the first attempt at this fix was a no-op: resolveFeedbackDir()
is itself cwd-dependent, so a "global" path derived from it resolves to the same location as
the repo-local one and the union collapses to a single entry. The global path is now built
from the home directory directly, and a test asserts the two paths are distinct.

This restores gate REACH. It does not give those gates teeth — most carry prose patterns
that cannot match a tool call, which is tracked separately.
