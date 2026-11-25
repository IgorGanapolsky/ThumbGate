---
"thumbgate": patch
---

Add thumbgate.ai/udemy for students of the free Udemy course: the free install first, Pro below it as optional, every link tagged utm_source=udemy. A visit is recorded as udemy even if the link lost its query string. THUMBGATE_INSTALL_SOURCE=udemy on `npx thumbgate init` is remembered in ~/.thumbgate/install-source and sent as the source on later CLI pings, so installs show under udemy in /v1/analytics/sources.
