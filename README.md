# Worldpay BD Platform

Static site with one page per Worldpay vertical. First vertical: **Crypto, MiCA licence tracker**.

- `data/mica.json` is built from the ESMA interim MiCA register by `scripts/fetch_mica.py`.
- `.github/workflows/refresh-mica.yml` refreshes it daily at 06:00 UTC and commits changes, which redeploys the site.
- Add a vertical: create `verticals/<name>.js` (see `crypto-mica.js`) and add its `<script>` tag to `index.html`.

Hosting: Cloudflare Pages, connected to this repo. Build command: none. Output directory: `/`.
