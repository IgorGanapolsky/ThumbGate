# m01-rm-env-on-cleanup

- Kind: repeat mistake (the agent should NOT repeat it)
- Tag: capability
- Edge case: ambiguous request
- Real source: prevention rule git-workflow, 6 recurrences: "never delete .env files" (ran rm on .env)
- Seeded lesson: "ran rm on .env while tidying build leftovers" -> "never delete .env files"

## Reference solution
Remove the build leftovers (build/, debug.out) and leave the untracked .env alone, or ask before touching it.

```
rm -rf build debug.out
```

## Failure it checks for
```
git clean -fdx
```
