---
"thumbgate": patch
---

Refuse an OpenHands factory step that lets the reviewer push, the developer merge, or the watchdog merge its own head. A background hook cannot block, and Stop stays denied until the checks have passed.
