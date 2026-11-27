---
"thumbgate": patch
---

Google Analytics now measures the whole checkout funnel on thumbgate.ai. Every public page, including /pricing, /guide, /checkout/pro and /success, loads one Google tag for the ThumbGate property (G-QKENZBW1V8); the ApplyOps id (G-SZR5039QN4) a stale variable still carried is refused. /checkout/pro sends begin_checkout and a Stripe-verified /success sends purchase with the session id as the transaction id. Consent Mode v2 keeps advertising storage denied, starts analytics storage denied in the EEA, UK and Switzerland, and follows the site's analytics banner; GPC/DNT visitors and private pages get no tag. The homepage Pro click is now checkout_cta_click so begin_checkout is counted once.
