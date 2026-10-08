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
