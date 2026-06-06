---
"thumbgate": patch
---

fix(statusline): aggregate feedback across all stores so the statusline shows the true cross-project total instead of only the slice for the folder it runs in. Previously the statusline read a single resolved feedback store, so it could show 8👍/0👎 in one repo while ~150 thumbs-down lived in another project's store. Adds a read-only cross-store sum (deduped by feedback id) over the global stores + the active project; opt back to per-folder counts with THUMBGATE_STATUSLINE_SCOPE=project. Capture/write path unchanged.
