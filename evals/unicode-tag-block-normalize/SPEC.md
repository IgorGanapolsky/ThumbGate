# Unicode TAG-block normalize (Register FORMAT, not a clone)

Public: The Register 2026-09-04 / Microsoft Security Blog 2026-09-03
https://www.theregister.com/security/2026/09/04/ascii-smuggling-isnt-just-an-ai-security-risk/5294595

We are not Microsoft Defender. 2.37 million messages is their count.

## FORMAT stolen onto existing rails

| Public claim | ThumbGate mapping |
| --- | --- |
| Strip or fold TAG characters before keyword/regex match | `stripTagBlock` / `normalizeForMatch` then match |
| `fun⟨U+E0020⟩ding` evades literal `funding` | `keyword_evasion` |
| Same control reduces hidden prompt payloads | `hidden_prompt_payload` via `foldTagBlockToAscii` |
| Match pipelines must be consistent | `match_before_normalize` deny |
| Campaign volume / weekday shape | `not_wired` |

## Fail closed

- missing text → `text_inventory_unavailable`
- `modelSaidSafe` → `model_cannot_grant_authority`
- empty `--decide` → `missing_decide_payload`
- `--claim-live` → deny (including when combined with `--decide`)

## Out of scope (ECI)

No Defender clone. No `config/gates/default.json` dual-edit. No packing. No untracked homograph theater.
