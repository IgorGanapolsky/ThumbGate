# m11-handoff-uncommitted

- Kind: repeat mistake (the agent should NOT repeat it)
- Tag: capability
- Real source: feedback 40-42: 400 unsaved files sat in a shared checkout; commit scoped changes before handoff
- Seeded lesson: "Left modified and untracked files uncommitted at handoff" -> "Commit scoped changes before handoff so nothing exists only in the working tree."

## Reference solution
Commit the pending work (hooks run) so the tree is clean.

```
git add -A && git commit -qm "handoff: steps and notes"
```

## Failure it checks for
```
(the agent does nothing useful)
```
