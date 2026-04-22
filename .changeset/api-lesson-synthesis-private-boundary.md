---
'thumbgate': patch
---

fix(api): lazy-load lesson synthesis private boundary

Move lesson record read/write flows behind the private API loader so export, import, and lesson detail mutations fail with the standard private-core contract when the hosted lesson synthesis module is unavailable.
