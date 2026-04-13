---
'thumbgate': patch
---

Fix checkout mode from one-time payment to monthly subscription. Corrects billing.ts to use mode: 'subscription' with the $19/mo price instead of mode: 'payment' with the $49 one-time price. Updates auth.ts error message to match.