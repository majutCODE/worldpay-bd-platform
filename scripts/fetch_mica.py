"""Fetch ESMA interim MiCA register CSVs and build data/mica.json."""
import csv, io, json, re, sys, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path

BASE = "https://www.esma.europa.eu/sites/default/files/2024-12/"
SOURCES = {
    "CASP": "CASPS.csv",
    "EMT": "EMTWP.csv",
    "ART": "ARTZZ.csv",
    "Non-compliant": "NCASP.csv",
}
OUT = Path(__file__).resolve().parent.parent / "data" / "mica.json"


MIN_CASPS = 100        # register had ~190 CASPs by late 2025; fewer means a broken download
MAX_DROP = 0.2         # refuse to publish if total records shrink by more than 20%


def fetch(name, tries=5):
    req = urllib.request.Request(BASE + name, headers={"User-Agent": "Mozilla/5.0 (worldpay-bd-platform)"})
    for i in range(tries):
        try:
            raw = urllib.request.urlopen(req, timeout=60).read()
            break
        except Exception as e:
            if i == tries - 1:
                raise
            wait = 2 ** (i + 2)
            print(f"retry {name} in {wait}s: {e}", file=sys.stderr)
            time.sleep(wait)
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass


def col(row, *keys):
    """First non-empty value whose column name contains any key (case-insensitive)."""
    for k in keys:
        for name, v in row.items():
            if name and k.lower() in name.lower() and v and v.strip():
                return v.strip()
    return ""


def iso_date(s):
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%d.%m.%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(s.strip(), fmt).date().isoformat()
        except (ValueError, AttributeError):
            pass
    return ""


def split_list(s):
    return [p.strip() for p in re.split(r"\s*\|\s*", s) if p.strip()]


def country(code):
    code = (code or "").strip().upper()[:2]
    return "GR" if code == "EL" else code


OVERRIDES = OUT.parent / "mica_b2c_overrides.json"
BANK_RE = re.compile(r"\b(bank|banka|bankas|banca|banco|banque|bancaire|sparkasse|volksbank|raiffeisen\w*|kreditbank|caixa|caisse|cr[eé]dit|kbc|ing|abn amro|rabobank|nordea|bnp|societe generale|soci[eé]t[eé] g[eé]n[eé]rale|unicredit|intesa|commerzbank|dekabank|dz bank|helaba|bayernlb|lbbw|n26|revolut bank)\b|\beg$", re.I)


def classify(r, overrides):
    """B2C label for licensed CASPs, based on the MiCA services they are authorised for.
    B2C platform: a non-bank authorised to exchange crypto for fiat (customers pay in) or to run trading/brokerage for clients.
    B2C (bank): a bank offering crypto services to its own retail clients.
    B2B / institutional: only custody, transfer, advice, portfolio management or placing."""
    key = r["lei"] or r["company"]
    if key in overrides:
        return overrides[key], "manual override"
    if r["licence_type"] != "CASP":
        return "", ""
    sv = " ".join(r["services"]).lower()
    fiat = "for funds" in sv
    trading = any(k in sv for k in ("trading platform", "for other crypto", "execution of orders", "reception and transmission"))
    if not (fiat or trading):
        return "B2B", "custody/transfer/advisory services only"
    why = "crypto-for-fiat exchange" if fiat else "trading / order execution for clients"
    if BANK_RE.search(r["company"]):
        return "B2C bank", f"bank offering {why}"
    return "B2C", why


def apply_b2c(records):
    overrides = json.loads(OVERRIDES.read_text()) if OVERRIDES.exists() else {}
    for r in records:
        r["b2c"], r["b2c_reason"] = classify(r, overrides)


def main():
    if "--reclassify" in sys.argv:
        d = json.loads(OUT.read_text())
        apply_b2c(d["records"])
        OUT.write_text(json.dumps(d, ensure_ascii=False, indent=1))
        return
    records, counts = [], {}
    for ltype, fname in SOURCES.items():
        try:
            text = fetch(fname)
        except Exception as e:
            if ltype == "CASP":
                sys.exit(f"FAIL: could not download {fname}: {e}")
            print(f"WARN {fname}: {e}", file=sys.stderr)
            continue
        rows = list(csv.DictReader(io.StringIO(text)))
        counts[ltype] = len(rows)
        if rows:
            print(f"{fname}: {len(rows)} rows, columns: {list(rows[0].keys())}")
        for r in rows:
            name = col(r, "lei_name", "commercial_name", "name")
            if not name:
                continue
            date = iso_date(col(r, "authorisationNotificationDate", "authorisation", "notification", "decision_date", "date"))
            records.append({
                "company": name,
                "brand": col(r, "commercial_name"),
                "lei": (r.get("ae_lei") or "").strip(),
                "home_state": country(col(r, "homeMemberState", "member_state", "_cou_code")),
                "regulator": col(r, "competentAuthority", "authority"),
                "licence_type": ltype,
                "authorised": date,
                "end_date": iso_date(col(r, "EndDate")),
                "services": split_list(col(r, "serviceCode")) if ltype == "CASP" else [],
                "passported": [country(c) for c in split_list(col(r, "serviceCode_cou", "_cou")) if len(c.strip()) == 2] if ltype == "CASP" else [],
                "website": col(r, "website", "url"),
                "address": col(r, "address"),
                "comments": col(r, "comments", "reason", "infringement"),
                "last_update": iso_date(col(r, "lastupdate", "last_update")),
            })
    casps = sum(r["licence_type"] == "CASP" for r in records)
    undated = sum(not r["authorised"] for r in records if r["licence_type"] == "CASP")
    if casps < MIN_CASPS:
        sys.exit(f"FAIL: only {casps} CASPs parsed (expected >= {MIN_CASPS}); keeping existing data.")
    if undated > casps * 0.1:
        sys.exit(f"FAIL: {undated}/{casps} CASPs have no parseable date; ESMA format may have changed.")
    if OUT.exists():
        try:
            prev = len(json.loads(OUT.read_text()).get("records", []))
        except ValueError:
            prev = 0
        if prev >= MIN_CASPS and len(records) < prev * (1 - MAX_DROP):
            sys.exit(f"FAIL: records dropped from {prev} to {len(records)}; keeping existing data.")
    apply_b2c(records)
    records.sort(key=lambda x: (x["authorised"], x["company"]), reverse=True)
    OUT.parent.mkdir(exist_ok=True)
    if OUT.exists():
        try:
            if json.loads(OUT.read_text()).get("records") == records:
                print("No data changes.")
                return
        except ValueError:
            pass
    OUT.write_text(json.dumps({
        "source": "ESMA interim MiCA register",
        "source_url": "https://www.esma.europa.eu/esmas-activities/digital-finance-and-innovation/markets-crypto-assets-regulation-mica",
        "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "counts": counts,
        "records": records,
    }, ensure_ascii=False, indent=1))
    print(f"Wrote {len(records)} records to {OUT}")


if __name__ == "__main__":
    main()
