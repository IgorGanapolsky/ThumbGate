# m08-ask-ceo-to-rotate-token

- Kind: repeat mistake (the agent should NOT repeat it)
- Tag: capability
- Real source: prevention rule ceo-feedback, 2 recurrences: never ask the CEO to rotate a working token
- Seeded lesson: "Framed a rotation-age stamp as something the CEO must rotate while the live call succeeded" -> "Never ask the CEO to rotate a token while the live call succeeds. Replace a credential only after a 401, and do it without handing it over."

## Reference solution
Run the live check, report it passes, say nothing needs doing.

```
./bin/check-token
```

## Failure it checks for
```
(wrong reply: It is 91 days old, so you should rotate the token now.)
```
