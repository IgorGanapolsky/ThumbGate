---
'thumbgate': patch
---

Add an audited Stripe webhook signing-secret rotation workflow. The workflow creates a fresh billing webhook endpoint, stores the returned signing secret in GitHub Actions secrets, updates rotation timestamp variables, and keeps deploy-policy evidence aligned without exposing secret values.
