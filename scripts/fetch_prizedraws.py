"""Build a list of UK prize draw / competition operators into data/prizedraws.json.

Prize draws with a free entry route are not licensed, so there is no register. Two sources:
- DCMS Voluntary Code of Good Practice for Prize Draw Operators: the signatory list on GOV.UK, dated from the page's
  change history where a note names the operator, otherwise first seen.
- Companies House advanced search: active companies incorporated in the last 2 years whose name reads like a
  competition operator (competitions, comps, prizes, giveaways, raffles, draws) under gambling/leisure/online retail SIC codes.
If a source fails its records from the last good run are kept and the run exits 1 so the workflow opens an issue.
"""
import html, json, os, re, sys, time, urllib.parse, urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "prizedraws.json"
TODAY = date.today().isoformat()
DEBUG = os.environ.get("DEBUG")
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      "Accept-Language": "en-GB,en;q=0.9"}
CODE_PATH = "government/publications/voluntary-code-of-good-practice-for-prize-draw-operators"
CH = "https://find-and-update.company-information.service.gov.uk"
SOURCES = [
    {"code": "DCMS", "name": "DCMS prize draw code signatories", "min": 80,
     "url": f"https://www.gov.uk/{CODE_PATH}/voluntary-code-of-good-practice-for-prize-draw-operators#signatories"},
    {"code": "CH", "name": "Companies House new incorporations", "min": 30,
     "url": f"{CH}/advanced-search", "note": "name and SIC match, last 2 years"},
]
CH_TERMS = ["competitions", "comps", "prizes", "giveaways", "giveaway", "raffles", "raffle", "prize draws", "draws"]
CH_SIC = {"92000": "Gambling and betting", "93290": "Other amusement and recreation", "47910": "Online retail",
          "82990": "Other business support", "63120": "Web portals"}
NAME_RX = re.compile(r"\b(comps?|competitions?|prizes?|giveaways?|raffles?|draws?)\b", re.I)
NOT_RX = re.compile(r"\b(sport|students?|football|golf club|dance|cheer|swim|martial|darts? league|equestrian|horse show|motorsport|racing club|art|design awards?)\b", re.I)
MAX_DROP = 0.3


def get(url, tries=5):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            if i == tries - 1:
                raise
            print(f"  retry {url[:100]} in {2 ** (i + 2)}s: {e}", file=sys.stderr)
            time.sleep(2 ** (i + 2))


def text(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def norm(s):
    s = re.sub(r"\b(t/a|ta)\b.*", "", s.lower())
    s = re.sub(r"\b(ltd|limited|plc|llp|uk|the|group|holdings)\b|[^a-z0-9]", "", s)
    return s


def rec(src, company, **kw):
    r = {"company": company.strip(), "trading_as": "", "source": src, "signatory": src == "DCMS", "company_number": "",
         "status": "Active", "incorporated": "", "sic": [], "address": "", "date": "", "date_kind": "first_seen", "b2c": True}
    r.update(kw)
    return r


# ---------- DCMS voluntary code signatories (GOV.UK content API) ----------
def dcms(src):
    page = json.loads(get(f"https://www.gov.uk/api/content/{CODE_PATH}/voluntary-code-of-good-practice-for-prize-draw-operators"))
    body = page["details"]["body"]
    m = re.search(r"(?is)Operator signatories</h3>(.*?)(?:<h[23][^>]*>|$)", body)
    if not m:
        raise ValueError("operator signatories heading not found")
    names = [text(x) for x in re.split(r"(?i)<br\s*/?>|</p>|</li>", m.group(1))]
    names = [n for n in names if n and len(n) < 120]
    # change history on the publication page: "Added X, Y and Z as signatories"
    history = []
    for path in (CODE_PATH, f"{CODE_PATH}/voluntary-code-of-good-practice-for-prize-draw-operators"):
        try:
            d = json.loads(get(f"https://www.gov.uk/api/content/{path}"))
            history += [(h.get("public_timestamp", "")[:10], h.get("note", "")) for h in d.get("details", {}).get("change_history", [])]
        except Exception as e:
            print(f"  change history {path}: {e}", file=sys.stderr)
    history.sort()
    out = []
    for n in names:
        company, ta = (re.split(r"(?i)\s+t/a\s+", n, 1) + [""])[:2]
        added = next((d for d, note in history if d and n.lower() in note.lower()), "")
        out.append(rec("DCMS", company, trading_as=ta, date=added, date_kind="added" if added else "first_seen"))
    if DEBUG:
        print(f"  dcms: {len(out)} operators, {sum(bool(r['date']) for r in out)} dated from {len(history)} change notes")
    return out


# ---------- Companies House advanced search ----------
def ch_search(term, sic, since):
    rows, page = [], 1
    while page <= 20:
        q = {"companyNameIncludes": term, "sicCodes": sic, "status": "active", "page": page,
             "incorporationFromDay": since.day, "incorporationFromMonth": since.month, "incorporationFromYear": since.year}
        doc = get(f"{CH}/advanced-search/get-results?" + urllib.parse.urlencode(q))
        if DEBUG and page == 1 and term == CH_TERMS[0] and sic == "92000":
            i = doc.find("/company/")
            print("  ch sample html:", re.sub(r"\s+", " ", doc[max(0, i - 600):i + 1500]))
        found = 0
        for tr in re.findall(r"(?is)<tr.*?</tr>", doc):
            m = re.search(r'href="?/company/([A-Z0-9]{8})', tr)
            if not m:
                continue
            found += 1
            cells = [text(c) for c in re.findall(r"(?is)<li[^>]*>(.*?)</li>", tr)]
            rows.append((m.group(1), cells, tr))
        if not found or not re.search(r'(?i)rel="next"|Next page|govuk-pagination__next', doc):
            break
        page += 1
    return rows


def ch_date(s):
    m = re.search(r"\b(\d{1,2}) (January|February|March|April|May|June|July|August|September|October|November|December) (\d{4})\b", s)
    return datetime.strptime(" ".join(m.groups()), "%d %B %Y").date().isoformat() if m else ""


def ch(src):
    since = date.today() - timedelta(days=730)
    seen, out = set(), []
    for term in CH_TERMS:
        for sic in CH_SIC:
            for num, cells, tr in ch_search(term, sic, since):
                if num in seen:
                    continue
                seen.add(num)
                name = text(re.sub(r'(?is)<span class="govuk-visually-hidden">.*?</span>', "", re.search(r'(?is)href="?/company/[A-Z0-9]{8}[^>]*>(.*?)</a>', tr).group(1)))
                if not NAME_RX.search(name) or NOT_RX.search(name):
                    continue
                blob = " | ".join(cells)
                sics = sorted(set(re.findall(r"\b(\d{5})\b", next((c for c in cells if c.startswith("SIC")), ""))) & set(CH_SIC) | {sic})
                addr = next((c for c in cells if re.search(r"\b[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}\b", c) and not c.startswith("SIC")), "")
                inc = ch_date(blob)
                out.append(rec("CH", name.title(), company_number=num, incorporated=inc,
                               sic=[f"{s} {CH_SIC[s]}" for s in sics], address=addr, date=inc, date_kind="incorporated"))
    if DEBUG:
        print(f"  ch: {len(seen)} companies seen, {len(out)} kept; sample {out[:2]}")
    return out


SCRAPERS = {"DCMS": dcms, "CH": ch}


def main():
    prev = {}
    if OUT.exists():
        try:
            prev = json.loads(OUT.read_text())
        except ValueError:
            pass
    prev_recs = prev.get("records", [])
    first_seen = {(r["source"], norm(r["company"])): r["date"] for r in prev_recs if r.get("date_kind") == "first_seen" and r.get("date")}
    by_src, failures, counts = {}, [], {}
    for src in SOURCES:
        old = [r for r in prev_recs if r["source"] == src["code"]]
        try:
            new = SCRAPERS[src["code"]](src)
            if len(new) < src["min"]:
                raise ValueError(f"only {len(new)} records (expected at least {src['min']})")
            if old and len(new) < len(old) * (1 - MAX_DROP):
                raise ValueError(f"{len(new)} records vs {len(old)} last run (drop over {int(MAX_DROP * 100)}%)")
            for r in new:
                if r["date_kind"] == "first_seen":
                    r["date"] = first_seen.get((r["source"], norm(r["company"])), TODAY)
            by_src[src["code"]] = new
        except Exception as e:
            failures.append(f"{src['code']}: {e}")
            print(f"FAIL {src['code']}: {e}", file=sys.stderr)
            by_src[src["code"]] = old
        counts[src["code"]] = len(by_src[src["code"]])
        print(f"{src['code']}: {counts[src['code']]} records")
    # Companies House rows that are also code signatories get flagged; signatories gain their company number.
    sig = {norm(r["company"]): r for r in by_src.get("DCMS", [])} | {norm(r["trading_as"]): r for r in by_src.get("DCMS", []) if r["trading_as"]}
    records = list(by_src.get("DCMS", []))
    for r in by_src.get("CH", []):
        s = sig.get(norm(r["company"]))
        if s:
            s.update(company_number=r["company_number"], incorporated=r["incorporated"], sic=r["sic"], address=r["address"])
        else:
            records.append(r)
    records.sort(key=lambda r: (r["date"], r["company"]), reverse=True)
    data = {"fetched_at": datetime.now(timezone.utc).isoformat(timespec="minutes"), "sources": SOURCES, "counts": counts,
            "failures": failures, "records": records}
    if prev.get("records") != records:
        OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1))
    else:
        print("No changes.")
    if failures:
        sys.exit("FAIL: " + "; ".join(failures))


if __name__ == "__main__":
    main()
