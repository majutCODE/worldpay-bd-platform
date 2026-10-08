"""Fetch gambling licence registers (UK, Malta, Gibraltar, Poland) and build data/gambling.json.

Each regulator is fetched independently. If one fails, its records from the last good run are kept and the
failure is reported (exit code 1) so the workflow opens an issue, while the other regulators still update.
"""
import csv, html, io, json, os, re, socket, sys, time, urllib.error, urllib.parse, urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "gambling.json"
TODAY = date.today().isoformat()
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      "Accept-Language": "en-GB,en;q=0.9"}
MAX_DROP = 0.3  # refuse a regulator's new data if its record count shrinks by more than 30%

# Some registers resolve to IPv6 addresses GitHub runners cannot reach; force IPv4.
_gai = socket.getaddrinfo
socket.getaddrinfo = lambda h, p, f=0, *a, **k: _gai(h, p, socket.AF_INET, *a, **k)

REGULATORS = [
    {"code": "UKGC", "country": "GB", "name": "UK Gambling Commission", "min": 1500,
     "url": "https://www.gamblingcommission.gov.uk/public-register/businesses/download"},
    {"code": "MGA", "country": "MT", "name": "Malta Gaming Authority", "min": 150,
     "url": "https://mgalicenseeregister.mga.org.mt/"},
    {"code": "GGC", "country": "GI", "name": "Gibraltar Gambling Commissioner", "min": 40,
     "url": "https://gamblingdivision.gov.gi/licence-holders", "note": "no grant dates published, date is first seen"},
    {"code": "MF", "country": "PL", "name": "Poland Ministry of Finance", "min": 10, "url": "https://www.gov.pl/web/finanse/legalny-hazard", "note": "no grant dates published, date is first seen"},
]


def get(url, tries=5, timeout=60, headers=None):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    for i in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                if r.status != 200:
                    raise IOError(f"HTTP {r.status}")
                raw = r.read()
                break
        except Exception as e:
            if i == tries - 1:
                raise
            wait = 2 ** (i + 2)
            print(f"  retry {url} in {wait}s: {e}", file=sys.stderr)
            time.sleep(wait)
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            pass


def text(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def iso(s):
    s = (s or "").strip()[:10]
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d.%m.%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    return ""


def rec(reg, company, **kw):
    r = {"company": company.strip(), "brands": [], "regulator": reg["code"], "jurisdiction": reg["country"], "hq": "",
         "licence_type": "", "activities": [], "licence_number": "", "status": "Active", "active": True,
         "granted": "", "date_kind": "issued", "expiry": "", "websites": []}
    r.update(kw)
    return r


# ---------- UK Gambling Commission: official CSV downloads ----------
def ukgc(reg):
    base = "https://www.gamblingcommission.gov.uk/downloads/business-licence-register-"
    rows = lambda n: list(csv.DictReader(io.StringIO(get(base + n + ".csv"))))
    names = {r["Account Number"]: r["Licence Account Name"] for r in rows("businesses")}
    extra = {}
    for kind in ("trading-names", "domain-names"):
        for r in rows(kind):
            vals = list(r.values())
            if len(vals) >= 2 and vals[1]:
                extra.setdefault((kind, vals[0].strip()), []).append(vals[1].strip())
    lic = {}
    for r in rows("licences"):
        key = r["Licence Number"]
        L = lic.setdefault(key, {"acct": r["Account Number"], "type": r["Type"], "statuses": set(), "acts": [], "starts": [], "ends": []})
        L["statuses"].add(r["Status"])
        if r["Activity"] and r["Activity"] not in L["acts"]:
            L["acts"].append(r["Activity"])
        if iso(r["Start Date"]):
            L["starts"].append(iso(r["Start Date"]))
        if iso(r["End Date"]):
            L["ends"].append(iso(r["End Date"]))
    out = []
    for num, L in lic.items():
        status = "Active" if "Active" in L["statuses"] else sorted(L["statuses"])[0]
        out.append(rec(reg, names.get(L["acct"], f"Account {L['acct']}"),
                       brands=sorted(set(extra.get(("trading-names", L["acct"]), [])))[:50],
                       websites=sorted(set(extra.get(("domain-names", L["acct"]), [])))[:200],
                       licence_type=L["type"], activities=L["acts"], licence_number=num, status=status,
                       active=status == "Active", granted=min(L["starts"]) if L["starts"] else "",
                       expiry=max(L["ends"]) if L["ends"] and status != "Active" else ""))
    return out


# ---------- Gibraltar: licence holders page (HTML tables, no dates) ----------
def ggc(reg):
    page = get(reg["url"])
    out = []
    # Each table follows a heading naming the category, e.g. "B2C Remote Gambling Operators".
    for m in re.finditer(r"(?is)((?:B2C|B2B|Gambling Operators Support)[^<]{0,80})</[^>]+>(?:(?!<table).){0,800}<table(.*?)</table>", page):
        category = text(m.group(1))
        ltype = "B2C" if category.startswith("B2C") else "B2B" if category.startswith("B2B") else "Support services"
        if "Non-Remote" in category:
            ltype += " land-based"
        for tr in re.findall(r"(?is)<tr.*?</tr>", m.group(2)):
            cells = re.findall(r"(?is)<td.*?>(.*?)</td>", tr)
            if len(cells) < 3:
                continue
            name = re.sub(r"\s*Approved Brands\s*$", "", text(cells[1]))
            if not name or name.lower().startswith("licence holder"):
                continue
            acts = [a.strip() for a in re.split(r"<br\s*/?>|\n|(?<=\))\s*(?=[A-Z])", cells[-1]) if text(a)]
            group = re.search(r"\(([^)]+)\)\s*$", name)
            out.append(rec(reg, name, licence_type=ltype, activities=[text(a) for a in acts],
                           brands=[group.group(1)] if group else [], date_kind="first_seen"))
    return out


# ---------- Malta MGA: Angular register behind Cloudflare with encrypted API, so render it in a browser ----------
MGA_TYPES = {"1": "Casino-type games", "2": "Fixed-odds betting", "3": "Peer-to-peer (poker, exchanges)", "4": "Controlled skill games"}


def mga(reg):
    from playwright.sync_api import sync_playwright
    out, seen = [], set()
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(user_agent=UA["User-Agent"])
        pg.goto(reg["url"], wait_until="networkidle", timeout=120000)
        pg.get_by_text("View All").first.click()
        pg.wait_for_selector("text=Search Results", timeout=60000)
        pg.wait_for_timeout(3000)
        try:  # largest page size the paginator offers
            pg.click("mat-paginator mat-select", timeout=5000)
            opts = pg.locator("mat-option")
            opts.nth(opts.count() - 1).click()
            pg.wait_for_timeout(3000)
        except Exception as e:
            print(f"  MGA page size unchanged: {e}", file=sys.stderr)
        total = None
        for _ in range(400):
            body = pg.inner_text("body")
            m = re.search(r"of (\d+)\s*$", body.strip().splitlines()[-1] if body.strip() else "") or re.search(r"\d+\s*[–-]\s*\d+ of (\d+)", body)
            total = int(m.group(1)) if m else total
            for block in body.split("Company Name\n")[1:]:
                f = lambda label: (re.search(label + r"\s*\n\s*([^\n]+)", block) or [None, ""])[1].strip()
                name = block.strip().splitlines()[0].strip()
                num = f("Authorisation Number")
                if not name or (name, num) in seen:
                    continue
                seen.add((name, num))
                kind = (re.search(r"MGA/([A-Z0-9]+)/", num) or [None, ""])[1]
                year = (re.search(r"/(\d{4})$", num) or [None, ""])[1]
                types = re.findall(r"Type (\d)", f("Authorisation type"))
                out.append(rec(reg, name, licence_number=num,
                               licence_type={"B2C": "B2C", "B2B": "B2B", "CRP": "Corporate"}.get(kind, kind),
                               activities=[MGA_TYPES.get(t, "Type " + t) for t in types],
                               granted=f"{year}-01-01" if year else "", date_kind="year" if year else "first_seen",
                               reg_no=f("Registration Number")))
            nxt = pg.locator("button.mat-mdc-paginator-navigation-next")
            if not nxt.count() or nxt.get_attribute("aria-disabled") == "true" or "disabled" in (nxt.get_attribute("class") or "").split("mat-mdc-button-disabled-interactive")[0]:
                break
            nxt.click()
            pg.wait_for_timeout(1500)
        b.close()
    if total and len(out) < total * 0.95:
        raise RuntimeError(f"parsed {len(out)} of {total} MGA licensees")
    return out


# ---------- Poland: Ministry of Finance "Legalny hazard" page (two tables, no dates) ----------
MF_SCOPE = {"kasyno online": "Online casino", "gry liczbowe i loterie pieniężne": "Numbers games and lotteries"}


def mf(reg):
    page = get("https://www.gov.pl/web/finanse/legalny-hazard")
    groups = {}
    for table in re.findall(r"(?is)<table.*?</table>", page):
        for tr in re.findall(r"(?is)<tr.*?</tr>", table):
            cells = [text(c) for c in re.findall(r"(?is)<td[^>]*>(.*?)</td>", tr)]
            if len(cells) not in (3, 4) or not re.fullmatch(r"\d+\.?", cells[0]) or "KRS" not in cells[1]:
                continue
            name = re.sub(r",?\s*KRS\s*\d+", "", cells[1]).strip(" ,")
            scope = MF_SCOPE.get(cells[2].lower(), cells[2]) if len(cells) == 4 else "Online betting"
            g = groups.setdefault((name, scope), {"sites": [], "krs": (re.search(r"KRS\s*(\d+)", cells[1]) or [None, ""])[1]})
            g["sites"] += [w for w in re.split(r"[\s,;]+", cells[-1].lower()) if "." in w]
    return [rec(reg, name, licence_type="State monopoly" if scope != "Online betting" else "Online betting",
                activities=[scope], licence_number=f"KRS {g['krs']}" if g["krs"] else "", websites=sorted(set(g["sites"])),
                date_kind="first_seen")
            for (name, scope), g in groups.items()]


SCRAPERS = {"UKGC": ukgc, "MGA": mga, "GGC": ggc, "MF": mf}


UK_B2C = re.compile(r"^(Casino|Bingo|General Betting|Pool Betting|Betting Intermediary|Society Lottery|External Lottery Manager)", re.I)


def is_b2c(r):
    """Online platform taking payments from consumers (what Worldpay can acquire)."""
    if r["regulator"] == "UKGC":
        return r["licence_type"] == "Remote" and any(UK_B2C.match(a) for a in r["activities"])
    if r["regulator"] == "MF":
        return True
    return r["licence_type"].startswith("B2C") and "land-based" not in r["licence_type"]


def key(r):
    return (r["regulator"], r["licence_number"] or r["company"].lower(), r["licence_type"])


def main():
    prev = {}
    if OUT.exists():
        try:
            prev = json.loads(OUT.read_text())
        except ValueError:
            pass
    prev_recs = prev.get("records", [])
    prev_by_key = {key(r): r for r in prev_recs}
    records, failures, counts = [], [], {}
    for reg in REGULATORS:
        old = [r for r in prev_recs if r["regulator"] == reg["code"]]
        fn = SCRAPERS.get(reg["code"])
        try:
            new = fn(reg)
            if os.environ.get("DEBUG"):
                print(json.dumps(new[:3], ensure_ascii=False, indent=1))
            if len(new) < reg["min"]:
                raise RuntimeError(f"only {len(new)} records (expected >= {reg['min']})")
            if old and len(new) < len(old) * (1 - MAX_DROP):
                raise RuntimeError(f"records dropped from {len(old)} to {len(new)}")
            for r in new:
                p = prev_by_key.get(key(r))
                if r["date_kind"] == "year" and old and (not p or p["date_kind"] == "first_seen"):
                    # Licence number only carries the year; once we have a baseline, a newly listed licence gets
                    # the exact day we first saw it.
                    r["date_kind"] = "first_seen"
                if r["date_kind"] == "first_seen":
                    # Registers without dates: keep the first date we saw the entry. Entries present at the
                    # first ever run stay undated so they do not show up as "new".
                    r["granted"] = p["granted"] if p else (TODAY if old else "")
            for r in new:
                r["b2c"] = is_b2c(r)
            print(f"{reg['code']}: {len(new)} records")
            records += new
            counts[reg["code"]] = len(new)
        except Exception as e:
            failures.append(f"{reg['code']}: {e}")
            print(f"FAIL {reg['code']}: {e}; keeping {len(old)} previous records", file=sys.stderr)
            records += old
            counts[reg["code"]] = len(old)
    if not records:
        sys.exit("FAIL: no records from any regulator; keeping existing data.")
    records.sort(key=lambda x: (x["granted"], x["company"]), reverse=True)
    if prev_recs == records:
        print("No data changes.")
    else:
        OUT.parent.mkdir(exist_ok=True)
        OUT.write_text(json.dumps({
            "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "regulators": [{k: v for k, v in g.items() if k != "min"} for g in REGULATORS if counts.get(g["code"])],
            "counts": counts,
            "failures": failures,
            "records": records,
        }, ensure_ascii=False, indent=1))
        print(f"Wrote {len(records)} records to {OUT}")
    if failures:
        sys.exit("FAIL: " + "; ".join(failures))


if __name__ == "__main__":
    main()
