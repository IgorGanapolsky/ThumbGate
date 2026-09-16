# Token-shunt honesty (Spotify Portal FORMAT steal)

Doctor: `npx thumbgate token-shunt-honesty --json --lines=<n>`

Steals **untargeted bulk-read intercepts** from [spotify/portal-ai-plugins](https://github.com/spotify/portal-ai-plugins) (shunt). Compare-not-clone. Not affiliated with Spotify.

Does **not** install `shunt@portal`, vendor `@spotify/portal-cli`, buy Spotify Portal, or claim 90% token savings from GitHub App install `162279530`.

## Contract

| Input | Verdict |
|-------|---------|
| Read of >350 lines, no offset/limit | `untargeted_bulk_read` fail |
| Targeted Read (`--targeted`) | allow |
| Bare `cat`/`head`/`tail`/`less`/`more` of a large file | `bare_bulk_cat` fail |
| `cat file \| grep` | allow |
| Architecture → Flash/Portal/AiKA | `cheap_worker_reasoning` fail |
| Return 800 of 800 lines | `full_file_dump` fail |
| `--clone-portal` | `portal_clone_refused` |

GitHub App **Igor Spotify Portal** (All repositories, contents+PR write) is a catalog connector, not a cash rail. ECI: do not sell ThumbGate through Portal.

## CLI

```bash
npx thumbgate token-shunt-honesty --json --lines=800
npx thumbgate token-shunt-honesty --json --lines=800 --targeted
npx thumbgate token-shunt-honesty --json --clone-portal
npm run test:token-shunt-honesty
```

Skill: `.agents/skills/token-shunt-honesty-not-clone/SKILL.md`
