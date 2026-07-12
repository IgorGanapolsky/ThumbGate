---
"thumbgate": patch
---

fix(feedback): stop promoting raw session-metadata JSON blobs as lessons — capture only the human .prompt and reject transport blobs (session_id/transcript_path/JSON) in the sanitizer so recall stays clean.
