---
"thumbgate": patch
---

Fix operator key blocked by general auth gate when THUMBGATE_API_KEY is also set. The general isAuthorized gate only checked the admin key, causing operator key requests to get 401 before reaching the billing/summary endpoint handler. Now the operator key is allowed to bypass the general gate specifically for GET /v1/billing/summary.
