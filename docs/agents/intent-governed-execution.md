# Intent → governed execution (CyberStrike FORMAT steal)

Doctor: `npx thumbgate intent-governed-execution --intent="…" --json`

Steals the **process shape** from [CyberStrikeAI](https://github.com/Ed1s0nZ/CyberStrikeAI) (surfaced by [@tom_doerr](https://x.com/tom_doerr/status/2094509419929174170)): natural-language intent becomes **governed execution**, human oversight gates high risk, and evidence returns to operational memory.

This is compare-not-clone. It does **not** install CyberStrikeAI, CloudWeGo Eino, WebShell, C2, or pentest recipe packs. Not affiliated.

## Six-step spine → ThumbGate rails

| Step | Rails |
|------|--------|
| classify | `intent-router` plan quality + `harness-selector` |
| authorize | session-lease / task-scope; offensive needs `THUMBGATE_ALLOW_OFFENSIVE=1` |
| gate | PreToolUse / `gates-engine` / `config/gates/*.json` |
| hitl | `admin-override`, protectedApprovals (`--approved` only after a real human grant) |
| execute | `subagent-profiles` + `context.maxChars` result governance |
| evidence | `capture-feedback` → lesson-retrieval → prevention rules |

## Fail closed

- Offensive/cyber intents without `THUMBGATE_ALLOW_OFFENSIVE=1` → `status=fail`
- High/critical without HITL → `checkpoint_required`
- Clone/vendor CyberStrike or Eino wording → `cyberstrike_clone_refused`

## Skill

`.agents/skills/cyberstrike-compare-not-clone/SKILL.md` — `/cyberstrike-compare-not-clone`
