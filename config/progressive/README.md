# Progressive wiring (Frigate-style)

Prove the pipe before you turn detection on.

| Phase | File | Enable matching? | Verify |
| --- | --- | --- | --- |
| 1 | `01-wire-only.json` | no | `npx thumbgate doctor` |
| 2 | `02-dashboard-empty-ok.json` | no | dashboard loads, empty OK |
| 3 | `03-one-lesson.json` | no | `npx thumbgate stats` |
| 4 | `04-warn-fires.json` | yes, warn | hook log / gate-stats |
| 5 | `05-strict-optional.json` | yes, strict | only after 1–4 |

Hidden metric: if nothing fires, check **hook install**, not rule count.

Live guide: `/guides/progressive-wiring`
