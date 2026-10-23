// Relays the ESMA MiCA register CSVs. ESMA's CDN blocks GitHub Actions runners (403 since 21 Oct 2026),
// so scripts/fetch_mica.py falls back to fetching through this function.
const FILES = new Set(["CASPS.csv", "EMTWP.csv", "ARTZZ.csv", "NCASP.csv"]);
const BASE = "https://www.esma.europa.eu/sites/default/files/2024-12/";

export default async function handler(req, res) {
  const f = String(req.query.f || "");
  if (!FILES.has(f)) return res.status(400).send("unknown file");
  const r = await fetch(BASE + f, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36", Accept: "text/csv,*/*" },
  }).catch(e => ({ ok: false, status: 502, statusText: String(e) }));
  if (!r.ok) return res.status(502).send(`ESMA returned ${r.status} ${r.statusText || ""}`);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(Buffer.from(await r.arrayBuffer()));
}
