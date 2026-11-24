---
"thumbgate": patch
---

Lifetime analytics no longer report fewer visitors than the 30-day window. When the telemetry log passed 64 MB the lifetime window silently read only a 4 MB tail while the 30-day window read 32 MB, so production showed 1,950 lifetime visitors against 13,947 for 30 days. The lifetime window now reads as much as the widest bounded window (64 MB). Counts are still marked partial (`telemetryWindowComplete: false`) when the log is larger than that.
