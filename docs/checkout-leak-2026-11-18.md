# Checkout leak, last 30 days (read 18 Nov 2026, about 5:20 PM)

Top cause: **562 of 576 checkout sessions (97.6%) were abandoned before any email was typed.** The session was created, nobody entered an email, and it expired after 24 hours. No card was attempted in any session, so declines are not the leak.

The Stripe test-mode checkout run was **not done**; see "Test-mode run" below. No price or copy was changed.

## Method

Read-only Stripe API calls (`checkout.sessions.list` with `payment_intent` expanded, plus charge, payment-intent, invoice and subscription lists) for sessions created 19 Oct to 18 Nov. All 576 are live mode. "External" means an email was captured that is not one of the owner's. "No email" means the buyer never reached the email field. Script: the one-off read-only scripts were run from the scratchpad, not committed. Only counts are recorded here.

## Counts by cause

| Cause | Sessions | Share |
|---|---|---|
| Session opened, no email entered, expired after 24 hours | 562 | 97.6% |
| Email entered, then stopped, no card attempt, expired | 14 | 2.4% |
| Card attempted and declined | 0 | 0% |
| Completed and paid by someone outside the owner | 0 | 0% |
| (Still open when read; counted in the 562) | 2 | |

Evidence for the zero rows, same 30 days: charges 1 (the owner's own $10, succeeded), failed charges 0, decline codes 0, payment intents 5 (1 succeeded for the owner, 4 canceled when their sessions expired), invoices 1 (paid, the owner's), subscriptions created 0.

## Where the 562 came from

| Origin | No-email sessions |
|---|---|
| thumbgate.ai website buttons (success URL `thumbgate.ai/success`) | 390 of 400 website sessions |
| Payment links and other success URLs | 172, of which 39 point at other sites' checkouts and are not ThumbGate sales |

Of the 400 website sessions:
- 141 were created in the same minute as at least two others. None of the 10 website sessions with an email was in such a burst, so these are probably automation. I can't prove that from the Stripe data.
- 259 were not in a burst. 10 of them have an email.
- Buttons that started them: pricing page Pro 144, direct-to-Stripe Pro 33, annual Pro 23, homepage Pro 21, dashboard demo 20, dashboard preview 19, comparison page 5, no button recorded 81.
- Plans: Pro monthly 196, Pro annual 42, Cloud startup 24, Cloud indie 22, $49 bundle 17, none recorded 77.
- The `installId` field is not a person identifier on the website path: one value covers 320 of the 400 sessions, including 9 different emails. Do not count unique installs from it.

## The 14 that entered an email

All expired unpaid after 24 hours with no charge and no decline. 10 were website Pro subscriptions (9 from the homepage root, none with a campaign), 4 were payment-link sessions. Which step on the Stripe page stopped them is not recorded in anything I can read.

## Referrer and page

Stripe keeps no browser referrer. Our own session metadata holds a landing path on 319 of 576 sessions (`/` on all of them), and nothing on the other 257. The 77 website sessions with no button, plan or install recorded came through a path that attaches no attribution, and none of them entered an email.

## Test-mode run: not done

The brief asked for one headless checkout in Stripe test mode. There is no test key to use: none in the vault (`STRIPE_TEST_SECRET_KEY`, `STRIPE_SECRET_KEY_TEST`, `STRIPE_TEST_KEY` all missing) and none in the Railway variables (only the live `STRIPE_SECRET_KEY`). The Stripe CLI is configured on this Mac, but running it was refused by the `financial-control` gate ("Economic actions require an explicit USD budget... fail closed"). I did not work around that and did not open any `buy.stripe.com` or `checkout.stripe.com` link. So no checkout step has been shown to break, and none has been shown to work.

## Biggest fix

The data cannot name a revenue cause between "the Stripe page puts people off" and "most sessions were never people". It does show that the 30-day denominator is polluted, and that is the fix with the most evidence behind it:

**Create the Stripe session only after a human click is confirmed, and record the page, referrer and user agent on it.** Today a session is created for every button hit, 141 of 400 in same-minute bursts, 257 of 576 with no landing page, and 77 with no attribution at all. That makes the 97.6% figure unreadable, and it means nobody can yet say whether real visitors leave at the Stripe page or never arrive.

Next measurement, after that fix: a week of sessions where the human share is known, plus the one Stripe test-mode run once a test key exists.
