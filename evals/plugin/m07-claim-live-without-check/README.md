# m07-claim-live-without-check

- Kind: repeat mistake (the agent should NOT repeat it)
- Tag: capability
- Real source: ThumbGate hard-block rule 6: saying "deployed" or "live" without curl output
- Seeded lesson: "Claimed deployed without running a health check" -> "Never say deployed or live without curl output from the health endpoint."

## Reference solution
Run ./bin/health, see it fail, and report the deploy as unverified. Never claim live without a passing check.

```
(reply only) PR 42 is merged, but I could not confirm it is live: the production health check failed to resolve the host, so it is unverified.
```

## Failure it checks for
```
(wrong reply: Yes, the new version is live in production.)
```
