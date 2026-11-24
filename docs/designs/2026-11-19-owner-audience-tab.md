# Change: an owner-only Audience tab: usage, attribution, location, people and bots

Status: proposed, 2026-11-19. Owner: builder session (Claude Sonnet 5.5) for the ThumbGate lead. Base commit: `5e72d375b` on `main`.

## Problem

The owner console answers "how many visitors" and "how much money" but not "who are they, where did they come
from, and where do they live". Facts, each read on 2026-11-19:

- Telemetry events already store visitor, session, install, referrer host, UTM fields, landing path, user agent and a
  bot, internal or test flag (`scripts/telemetry-analytics.js:547-684`). They store no location and no link from a
  visitor to a person.
- Checkout metadata carries `visitorId` and `acquisitionId` (`scripts/billing.js:1221-1222`, `3803-3804`), so a paid
  Stripe checkout can be tied back to a visit. Sign-in sessions keep the email but not the visitor
  (`src/api/server.js:6710-6735`).
- Production holds 27,460 visitors in 30 days, 8,644 of them flagged bot or internal, and 53 of 53 checkouts started
  this week carry no classification (owner analytics run inside the Railway container, 2026-11-19).
- The public privacy page promises first-party identifiers are "not linked to a name or email unless you submit one"
  and honors GPC and Do Not Track by not collecting (`public/privacy.html:66`, `79-83`). The README and
  `docs/COMMERCIAL_TRUTH.md:88` call CLI telemetry "anonymous". New collection must fit those words or change them
  in the same release.

## Goals and non-goals

- Goal: an Audience tab in `/admin` with five views: Usage, Attribution, Location, People (with a per-person
  timeline), and a real-person or bot mark on every row with its reason.
- Goal: location without any paid API and without sending an IP to a third party: an offline lookup bundled in the
  hosted image; the raw IP is never stored.
- Goal: the privacy page says exactly what is collected and why, in the same release.
- Not a goal: any change to the public CLI package. The location library is installed in the hosted Docker image
  only, never as a dependency of the `thumbgate` npm package.
- Not a goal: new third-party processors or new cookies.
- Must stay true: nothing from this tab appears on a public route; a GPC or Do Not Track visit still produces no
  telemetry, so no location and no hash; no raw IP address in any file under the data folder.

## Alternatives considered

- Do nothing: the lead cannot see who the visitors are; rejected by the request.
- A paid or hosted geolocation API: rejected, the request forbids sending IPs out and spending money.
- Add `geoip-lite` to `package.json` dependencies: rejected, the free CLI would download a database of about 100 MB
  for every user. Install it with `npm install --no-save` in the Dockerfile and load it with a guarded `require`.
- Country-only location: cheaper, but the request asks for city. Kept as the fallback when the city database is
  missing.
- Raw IP storage: rejected. A salted hash lets the owner see "same network" without keeping the address.
- Store person data in a new database: rejected. The tab joins at read time from the telemetry log, a small
  sign-in link log, and Stripe, so no new store holds a second copy of people.

## Requirements

- REQ-01: Every web telemetry event received without a GPC or Do Not Track signal gets `geo` (`country`, `region`,
  `city`) from the offline database and `ipHash` (first 16 hex of HMAC-SHA256 of the client IP with the server
  salt). The raw IP appears in no stored line.
  Check: `node --test --test-name-pattern="no raw IP" tests/owner-audience.test.js` writes events with a known IP and
  fails if the IP text is found in any file under the feedback directory.
- REQ-02: CLI telemetry events get country only: no city, no region, no `ipHash`.
  Check: `node --test --test-name-pattern="CLI events" tests/owner-audience.test.js`.
- REQ-03: A request carrying `Sec-GPC: 1` or `DNT: 1` writes nothing, so no location is stored for it.
  Check: `node --test --test-name-pattern="privacy signal" tests/owner-audience.test.js`.
- REQ-04: Without the salt environment variable, `ipHash` is absent and the tab says "hashing is off: no salt is
  configured"; without the geo library, location fields are absent and the tab says "location database not
  installed". Neither shows a bare Unknown.
  Check: `node --test --test-name-pattern="missing salt|missing database" tests/owner-audience.test.js`.
- REQ-05: `GET /v1/admin/audience` answers 403 to a signed-out request and 403 to a signed-in account that is not on
  the owner list, with no data in the body. No public route returns any audience field.
  Check: `node --test --test-name-pattern="403" tests/owner-audience.test.js`.
- REQ-06: A visit with `utm_source=x` shows source `x` on its attribution row and carries `x` through the checkout
  start and the paid step of the source funnel.
  Check: `node --test --test-name-pattern="utm_source=x" tests/owner-audience.test.js`.
- REQ-07: The source funnel shows, per source, visitors, sign-ups, checkouts started and paid; a stage that cannot be
  tied to a visit (installs without an acquisition ID) shows its count with the reason, never a blank.
  Check: `node --test --test-name-pattern="funnel" tests/owner-audience.test.js`.
- REQ-08: Usage shows daily active installs, CLI and MCP sessions, first blocks, feedback events and the version mix
  from CLI telemetry, with website visitors and sessions beside them.
  Check: `node --test --test-name-pattern="usage" tests/owner-audience.test.js`.
- REQ-09: A sign-in appends one row (time, provider, email, visitor ID, IP hash) to `audience-identities.jsonl`; the
  People table joins those rows with Stripe checkout email and name by visitor ID, guesses the company from the
  email domain (free mail domains show "personal email"), and clicking a row loads that person's timeline.
  Check: `node --test --test-name-pattern="people" tests/owner-audience.test.js`.
- REQ-10: Every visitor row is marked `person`, `bot`, `internal` or `test` with the reason codes the existing
  classifier produced; internal and test rows are excluded unless `include=internal` is passed.
  Check: `node --test --test-name-pattern="bot" tests/owner-audience.test.js`.
- REQ-11: The Audience tab renders with each source missing (no telemetry, no identities, no Stripe key, no geo
  library, no salt) with no camelCase label, no bare number and no bare Unknown.
  Check: `node --test --test-name-pattern="renders" tests/owner-audience.test.js`.
- REQ-12: A 50 MB telemetry log returns the Audience views in under 3 seconds on the fixture, using the same
  newest-first streaming reader as Analytics.
  Check: `node --test --test-name-pattern="50 MB" tests/owner-audience.test.js`.
- REQ-13: `public/privacy.html` states each new item (approximate location, IP hash, sign-in link row, retention) and
  the README and `docs/COMMERCIAL_TRUTH.md` no longer call CLI telemetry "anonymous" if country is stored.
  Check: `node --test tests/owner-audience.test.js` privacy block asserts each phrase, and
  `node scripts/check-congruence.js` still passes.

## Design

- **Ingestion.** `appendTelemetryEvent` gains an options argument with `clientIp`. `scripts/owner-geo.js` (new)
  lazily requires `geoip-lite` inside `try`, returns `{country, region, city}` or `null`, and computes the HMAC
  hash from `THUMBGATE_AUDIENCE_SALT`. The IP is read once at the ping handler (`src/api/server.js:10259`), passed
  down, and dropped. The client IP comes from the first address Railway's proxy appends; the build step checks this
  against production with a request carrying a forged `X-Forwarded-For`.
- **Identity link.** `completeSsoSessionAndRedirect` appends to `audience-identities.jsonl`, reading the first-party
  visitor cookie the telemetry already uses (`thumbgate_visitor_id` or `tg_vid`).
- **Reader.** `scripts/owner-audience.js` (new) reuses `scanTelemetry` (newest first, 30-day window, byte cap) with
  an `onEntry` that folds events into per-visitor records, then builds Usage, Attribution, Location, People and the
  funnel. Stripe sessions come through the existing two-lane reader. Results are cached 60 seconds.
- **Route.** `GET /v1/admin/audience?view=usage|attribution|location|people|person&id=&include=` handled inside the
  existing admin branch, which already enforces the owner list, private headers and the response size limit. A
  signed-out request to this path answers 403 instead of the 404 the other admin APIs use, as requested.
- **Page.** A sixth section in `public/admin.html` using the same plain-words helpers as Money and Observability.
- **Deployment.** `Dockerfile` adds `npm install --no-save geoip-lite@1.4.10`; the salt is set as a Railway
  variable. Rollback: remove the Dockerfile line; the guarded `require` degrades to "location database not
  installed" and the rest keeps working.
- **Retention.** Telemetry already trims by size; the identity log trims at 4 MB like the ops log.

## Risks

- Privacy exposure: the tab joins email to behaviour. Limited by owner-only access, no public route, no raw IP, a
  privacy page that says so, and the GPC and Do Not Track gate that already stops collection.
- Memory: `geoip-lite` loads its database into memory (about 100 MB). Limited by lazy loading on the first web
  event; REQ-12 and a production memory reading before and after are required before the release is called done.
- Wrong location behind a proxy: a misread header would put every visitor in one city. Limited by the forged-header
  check above and by showing the top country share so an implausible spread is visible.
- Bot classification is heuristic: shown with reason codes so the owner can judge each row.

## Unknowns

- Which header carries the true client IP on Railway: checked at build time against production.
- Whether `geoip-lite` installs cleanly on the Alpine base image (it is pure JavaScript with bundled data, but not
  yet run there): checked in a local Docker build before merging.
- How many production visitors will carry a visitor ID at sign-in; the People table shows the linked share.

## Files changed

- `scripts/owner-geo.js` (new)
- `scripts/owner-audience.js` (new)
- `scripts/telemetry-analytics.js`
- `scripts/owner-admin.js`
- `src/api/server.js`
- `public/admin.html`
- `public/privacy.html`
- `README.md`
- `docs/COMMERCIAL_TRUTH.md`
- `Dockerfile`
- `tests/owner-audience.test.js` (new)
- `package.json` (test registration only)

## Limits

Owner: builder session. Write scope: the files above. Review rounds: one goldfish review before building, two
fixes allowed. Tests run one file at a time under `nice -n 15`.

## Evidence

Filled in when the work is done.

| Requirement | Check run | Result | Commit | Where the output is |
|---|---|---|---|---|
| REQ-01 | | | | |
