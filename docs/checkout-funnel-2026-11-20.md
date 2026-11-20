# Checkout funnel: who the 76 were, and the step we fixed (read Nov 20, 2026, about 9:55 AM ET)

**Short answer.** None of the 76 Stripe Checkout sessions was paid, none had an email, and none was created after the human-click gate went live (Nov 18, 7:04 PM ET). At most 32 of the 76 could have been real people. Since the gate, 76 visits to the confirm page came from non-bot browsers (64 distinct visitors) and no one pressed the pay button. The one defect I could reproduce for a real browser is that a refused press sent the buyer back to an identical page with no message. That is fixed.

## Where the 76 comes from

The money board's 76 is `state/money-board-thumbgate.json`: Stripe `checkout.sessions.list`, created Nov 12, 11:17 AM ET to Nov 19, 11:17 AM ET, all live mode. Read again today with the same window (`railway ssh` into the thumbgate service, Stripe API read-only, key never printed): 76 sessions, 23 payment mode and 53 subscription mode, 76 expired and unpaid, 0 complete, 0 with an email or `customer_details`. Today's rolling 7 days shows 49 (36 on a thumbgate.ai success URL) because the oldest sessions have aged out.

Stripe stores no user agent or IP on a session, and the checkout-start endpoint logs no IP. The only per-visitor record is the telemetry ping, which has the user agent and a bot flag keyed by `visitorId`. The sessions carry that `visitorId` in metadata, so I joined them.

| Class (all 76 are unpaid, no email) | Sessions |
|---|---|
| Not the ThumbGate site: payment links and other sites' success URLs (stripe.com 11, deals.igorganapolsky.com 5, thumbgate.app 5, macyolosafeguards.io 1) | 22 |
| thumbgate.ai, no `visitorId` (a link was opened without our page) | 9 |
| thumbgate.ai, visitor has no telemetry at all | 6 |
| thumbgate.ai, created in the same minute as two or more others | 7 |
| thumbgate.ai, visitor with a non-bot browser user agent, not in a burst (**upper bound for real people**) | 32 |

The 32 are an upper bound, not a count of people: before the gate a session opened on a plain GET of `/go/pro-direct`, so a crawler with a browser-looking user agent looks the same. For most of the 32 the only telemetry event is the server's own `pro_checkout_direct_stripe`; no page view or confirm-page view precedes it.

## Since the gate (Nov 18, 7:04 PM ET to Nov 20, 9:52 AM ET)

Hosted telemetry, `checkout_interstitial_view` over the last 7 days: 268 rows. 23 bot-flagged, 15 internal, 230 human-class (203 visitors). 48 of those 230 sit in same-5-second sweeps across several visitors, which is a link scanner with a browser user agent. After removing them: 182 views from 157 visitors; since the gate, 76 views from 64 visitors.

- Stripe sessions created since the gate: **0** (newest session Nov 18, 3:59 PM ET).
- `checkout_interstitial_cta_clicked` (the button press): **0** rows in 7 days. `checkout_human_gate_refused`: **0** rows in 7 days.
- Hosted billing summary (session-start revenue bootstrap): `stripeConfirms` 0 today, 85 over 30 days.

So the biggest drop on the real-people path is "saw the confirm page, pressed the pay button": 64 visitors, 0 presses. Nothing in the data says why.

## Candidate steps checked

| Candidate | Result |
|---|---|
| Price on page differs from Checkout | No. Monthly page "$19/mo" and Stripe `amount_total` 1900; annual "$149/yr" and 14900. Read from production HTML on thumbgate.ai, www.thumbgate.ai and the Railway host. |
| Currency | No. 36 of 36 sessions in the last 7 days are `usd`. |
| Missing trust or refund line | No. "Cancel anytime. 7-day refund, no questions." is on the page under the button (production HTML). |
| Extra field | Not on the direct path. The email box sits only under "Other ways to buy". Stripe's own page adds a promotions consent and a tax-ID checkbox; not evaluated, since no real person has reached it since the gate. |
| Gate blocks real browsers | Not on production. `POST /v1/checkout/click-token` with a browser user agent returned 200 on thumbgate.ai and www.thumbgate.ai (no session is created by that call). In headless Chromium against a local server with a fake Stripe client, desktop Chrome and iPhone Safari user agents each reached the Stripe redirect on the first press (stripe.com requests were aborted; nothing live was opened). |
| Slow redirect | Not measured. |

## What changed

One reproduced defect: when the gate refuses a press (third press in a minute from one IP, token expired, replayed, or tied to a different IP or user agent), the server answered 302 or re-rendered the confirm page and the buyer saw the same page with an empty note. In the headless run the third press from one IP did exactly that.

`src/api/server.js`: a refused press now returns to the confirm page with `gate_notice=retry|network|busy`, and the page shows one fixed sentence in the note under the button ("We couldn't confirm that click. Press the button again." / "Your connection changed while we confirmed the click. Press the button again." / "Many checkouts are starting from your network right now. Wait a minute, then press the button again."). Only those three codes render; anything else is ignored. Bots and non-browser agents get no notice. The same applies to the email form on `/checkout/pro`. Tests: `tests/checkout-human-gate.test.js` (4 new, 44 pass); with the notice code disabled, 3 of them fail. Headless iPhone-UA run after the change: presses 1 and 2 reach Stripe, press 3 shows the "Wait a minute" note.

## Not fixed, not verified

- 20 of the 182 single-visitor views carry `plan_id` `bundle_49`, `playbook_999` or `team`, but the page always shows "Start ThumbGate Pro, $19/mo" because the plan view looks only at `billing_cycle`. The headless run did not reproduce it for a normal browser (the $49 and $9.99 links went to their payment links), so those views are probably crawlers or browsers without Sec-Fetch headers. Open.
- How often a real person hits a refusal in production is unknown: no refusal rows exist, and the new notice does not change that.
- Whether any real person is pressing the button is unknown; `checkout_interstitial_cta_clicked` has 0 rows in 7 days and the cause is not established.
- The change reaches production only after Railway rebuilds `main`; check `/health` for the commit.

## Reproduce

```
railway ssh -s thumbgate -- node <script>   # read-only Stripe list + telemetry-pings.jsonl join
node --test tests/checkout-human-gate.test.js
```
