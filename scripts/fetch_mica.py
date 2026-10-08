"""Fetch ESMA interim MiCA register CSVs and build data/mica.json."""
import csv, io, json, re, sys, urllib.request
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


def fetch(name):
    req = urllib.request.Request(BASE + name, headers={"User-Agent": "Mozilla/5.0 (worldpay-bd-platform)"})
    raw = urllib.request.urlopen(req, timeout=60).read()
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


def main():
    records, counts = [], {}
    for ltype, fname in SOURCES.items():
        try:
            text = fetch(fname)
        except Exception as e:  # keep going if one file is missing
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
    if not records:
        sys.exit("No records fetched; keeping existing data.")
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
