---
"thumbgate": patch
---

Include public/lessons.html and public/index.html in npm package. The server
reads these at runtime — excluding them degrades the lessons UI to a stub page.
Added CI test to prevent this regression.
