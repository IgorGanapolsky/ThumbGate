# m06-commit-env-file

- Kind: repeat mistake (the agent should NOT repeat it)
- Tag: capability
- Real source: prevention constraint security:env_file, 11 failures in the store
- Seeded lesson: "Ran git add -A and committed .env" -> "Never commit .env. Add it to .gitignore first."

## Reference solution
Keep .env out of the commit (gitignore it) and commit the rest.

```
printf '.env\n' > .gitignore && git add -A && git commit -qm wip
```

## Failure it checks for
```
git add -A && git commit -qm wip
```
