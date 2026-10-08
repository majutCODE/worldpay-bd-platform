# Worldpay BD Platform

Static site with one page per Worldpay vertical. First vertical: **Crypto, MiCA licence tracker**.

- `data/mica.json` is built from the ESMA interim MiCA register by `scripts/fetch_mica.py`.
- B2C labels for CASPs are set by `classify()` in `scripts/fetch_mica.py` from authorised services. Correct any company in `data/mica_b2c_overrides.json` as `{"<LEI or company name>": "B2C" | "B2C bank" | "B2B"}`.
- `.github/workflows/refresh-mica.yml` refreshes it daily at 06:00 UTC and commits changes, which redeploys the site.
- Add a vertical: create `verticals/<name>.js` (see `crypto-mica.js`) and add its `<script>` tag to `index.html`.

Hosting: Vercel, connected to this repo (static, no build step). Each data commit redeploys.

If a refresh fails (download error, too few records, format change), the job keeps the last good data and opens a GitHub issue labelled `refresh-failure`, which emails the repo owner. It closes the issue on the next successful run.

## Gambling licence tracker

`scripts/fetch_gambling.py` builds `data/gambling.json`; `.github/workflows/refresh-gambling.yml` runs it at 06:15 and 14:15 UTC.
Each regulator is fetched separately: one failing keeps its last good data, the rest still update, and an issue labelled `gambling-refresh-failure` opens.

| Regulator | Source | Dates |
|---|---|---|
| UK Gambling Commission | official CSV downloads | licence start dates |
| Malta Gaming Authority | licensee register (JS app, read with headless Chromium) | year from licence number, exact first-seen date for new ones |
| Gibraltar | gamblingdivision.gov.gi/licence-holders | first seen |
| Poland Ministry of Finance | gov.pl/web/finanse/legalny-hazard | first seen |

## Events

`scripts/fetch_events.py` builds `data/events.json` (upcoming London and Amsterdam events) from Luma (city feeds, crypto category, search), Meetup search and the AffPapa iGaming events directory. Events are tagged crypto or gaming by keyword and shown on each vertical's Events page. Refreshed by `.github/workflows/refresh-events.yml` at 06:30 and 14:30 UTC; failures open an issue labelled `events-refresh-failure`.

## Company profiles and payment provider detection

Click any company name in a licence table to open its profile: every licence it holds across verticals (matched by name, ignoring legal suffixes, and by shared website), its websites, detected payment providers, and LinkedIn / Companies House search links. LinkedIn people data can't be pulled in legitimately, so those are pre-filled searches.

`scripts/detect_psp.py` scans the websites of B2C licence holders in every `data/*.json` licence file (homepage plus up to five payment, FAQ, privacy and terms pages) and writes `data/psp.json`. It flags acquirers (Stripe, Adyen, Nuvei, Checkout.com, Worldpay, Paysafe…), crypto on-ramps, open banking and wallets. Evidence is `script` (provider code loads on the site), `header` (provider allowed in the Content-Security-Policy) or `mention` (named or logo shown). Checkout pages behind login can't be seen, so "none found" means none visible publicly. Each domain is rescanned every 14 days; `.github/workflows/refresh-psp.yml` runs daily at 07:00 UTC, failures open an issue labelled `psp-refresh-failure`.
