"""Detect payment providers (PSPs, acquirers, wallets, crypto on-ramps) on B2C company websites.

Reads every data/*.json licence file with a `records` list, takes B2C records and their websites, and scans each
domain's homepage plus a few payment, deposit, FAQ, privacy and terms pages. Writes data/psp.json keyed by domain.

Evidence strength:
  script  the provider's script, iframe or form is loaded on the site (strongest)
  header  the provider's domain is allowed in the site's Content-Security-Policy
  mention the provider is named or its logo shown on a payment, FAQ, privacy or terms page

Results are cached: a domain is rescanned after RESCAN_DAYS, at most MAX_SCANS domains per run.
"""
import concurrent.futures as cf, gzip, html, json, os, re, socket, sys, time, urllib.parse, urllib.request, zlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "psp.json"
RESCAN_DAYS = int(os.environ.get("RESCAN_DAYS", 14))
MAX_SCANS = int(os.environ.get("MAX_SCANS", 900))
MAX_SITES_PER_COMPANY = 5
MAX_PAGES = 6
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,*/*;q=0.8", "Accept-Language": "en-GB,en;q=0.9", "Accept-Encoding": "gzip, deflate"}

_gai = socket.getaddrinfo
socket.getaddrinfo = lambda h, p, f=0, *a, **k: _gai(h, p, socket.AF_INET, *a, **k)

# name, kind, domain regex (script/iframe/CSP), text regex (mentions on payment/legal pages, case-sensitive unless (?i))
PSPS = [
    ("Worldpay", "acquirer", r"worldpay\.(com|us)|wp-cdn\.|worldpayonline", r"(?i)\bworld ?pay\b"),
    ("Stripe", "acquirer", r"(js|checkout|api|m)\.stripe\.(com|network)|stripe\.com", r"\bStripe\b"),
    ("Adyen", "acquirer", r"adyen(payments)?\.com|checkoutshopper-", r"(?i)\badyen\b"),
    ("Checkout.com", "acquirer", r"(^|[./])checkout\.com", r"(?i)\bcheckout\.com\b"),
    ("Nuvei", "acquirer", r"nuvei\.com|safecharge\.com", r"(?i)\b(nuvei|safecharge)\b"),
    ("Paysafe", "acquirer", r"(^|[./])paysafe\.com|paysafe\.js|paysafe-?checkout", r"(?i)\bpaysafe\b(?!card)"),
    ("Braintree", "acquirer", r"braintree(gateway|-api)\.com", r"\bBraintree\b"),
    ("Worldline", "acquirer", r"worldline\.com|ogone\.com|ingenico\.com|saferpay\.com|payone\.com|paymentiq\.io", r"(?i)\b(worldline|ogone|saferpay|payone|paymentiq)\b"),
    ("Trust Payments", "acquirer", r"trustpayments\.com|securetrading\.(net|com)", r"(?i)\b(trust ?payments|secure ?trading)\b"),
    ("Ecommpay", "acquirer", r"ecommpay\.com", r"(?i)\becommpay\b"),
    ("Praxis", "acquirer", r"praxis(cashier|\.tech)|cashier\.praxis", r"(?i)\bpraxis (tech|cashier)\b"),
    ("Truevo", "acquirer", r"truevo\.(com|eu)", r"(?i)\btruevo\b"),
    ("Emerchantpay", "acquirer", r"emerchantpay\.(com|net)|emspay", r"(?i)\bemerchantpay\b"),
    ("Global Payments", "acquirer", r"globalpay(ments)?\.com|realexpayments\.com|globaliris", r"\bGlobal Payments (Inc|Europe|UK|Ltd|Limited)\b|\b[Rr]ealex\b"),
    ("Shift4", "acquirer", r"shift4\.com", r"(?i)\bshift4\b"),
    ("Rapyd", "acquirer", r"rapyd\.net", r"(?i)\brapyd\b"),
    ("Fiserv", "acquirer", r"fiserv\.com|ipg-online\.com|firstdata\.com|clover\.com", r"(?i)\b(fiserv|first data)\b"),
    ("Elavon", "acquirer", r"elavon\.com|convergepay\.com", r"(?i)\belavon\b"),
    ("Barclaycard", "acquirer", r"epdq\.co\.uk|barclaycard", r"(?i)\bbarclaycard\b"),
    ("Mollie", "acquirer", r"mollie\.com", r"\bMollie\b"),
    ("Airwallex", "acquirer", r"airwallex\.com", r"(?i)\bairwallex\b"),
    ("Mangopay", "acquirer", r"mangopay\.com", r"(?i)\bmangopay\b"),
    ("Square", "acquirer", r"squareup\.com|squarecdn\.com", r"\bSquare(up)? payments\b"),
    ("SumUp", "acquirer", r"sumup\.com", r"(?i)\bsumup\b"),
    ("PayPal", "wallet", r"paypal(objects)?\.com", r"(?i)\bpaypal\b"),
    ("Apple Pay", "wallet", r"apple-pay-gateway|applepay\.cdn-apple", r"(?i)\bapple ?pay\b"),
    ("Google Pay", "wallet", r"pay\.google\.com", r"(?i)\bgoogle ?pay\b"),
    ("Skrill", "wallet", r"skrill\.com", r"(?i)\bskrill\b"),
    ("Neteller", "wallet", r"neteller\.com", r"(?i)\bneteller\b"),
    ("Paysafecard", "wallet", r"paysafecard\.com", r"(?i)\bpaysafecard\b"),
    ("MuchBetter", "wallet", r"muchbetter\.com", r"(?i)\bmuch ?better\b"),
    ("Payz", "wallet", r"payz\.com|ecopayz\.com", r"(?i)\b(payz|ecopayz)\b"),
    ("Jeton", "wallet", r"jeton\.com", r"(?i)\bjeton\b"),
    ("Klarna", "wallet", r"klarna\.(com|net)|klarnacdn", r"(?i)\bklarna\b"),
    ("Revolut Pay", "wallet", r"merchant\.revolut\.com", r"(?i)\brevolut pay\b"),
    ("Trustly", "open banking", r"trustly\.(com|net)", r"(?i)\btrustly\b"),
    ("TrueLayer", "open banking", r"truelayer\.com", r"(?i)\btruelayer\b"),
    ("Volt", "open banking", r"volt\.io", r"\bVolt\.io\b|\bVolt open banking\b"),
    ("Token", "open banking", r"token\.io", r"\bToken\.io\b"),
    ("Yapily", "open banking", r"yapily\.com", r"(?i)\byapily\b"),
    ("MoonPay", "on-ramp", r"moonpay\.com", r"(?i)\bmoonpay\b"),
    ("Banxa", "on-ramp", r"banxa\.com", r"(?i)\bbanxa\b"),
    ("Simplex", "on-ramp", r"simplex(-affiliates)?\.com|simplexcc", r"\bSimplex\b"),
    ("Mercuryo", "on-ramp", r"mercuryo\.io", r"(?i)\bmercuryo\b"),
    ("Ramp", "on-ramp", r"ramp\.network", r"(?i)\bramp network\b"),
    ("Transak", "on-ramp", r"transak\.com", r"(?i)\btransak\b"),
    ("Sardine", "on-ramp", r"sardine\.ai", r"(?i)\bsardine\.ai\b"),
    ("Onramper", "on-ramp", r"onramper\.com", r"(?i)\bonramper\b"),
    ("Paybis", "on-ramp", r"paybis\.com", r"(?i)\bpaybis\b"),
]
PSPS = [(n, k, re.compile(d, re.I), re.compile(t)) for n, k, d, t in PSPS]
AMBIGUOUS_LOGO = {"Token", "Square", "Volt", "Ramp", "Praxis", "Simplex", "Sardine", "Mollie", "Payz"}
LOGO_TOKEN = {n: re.compile(r"(?<![a-z])" + re.escape(n.lower().replace(" ", "").replace(".", ""))) for n, *_ in PSPS if n not in AMBIGUOUS_LOGO}
PAGE_HINT = re.compile(r"(?i)payment|deposit|withdraw|banking|cashier|fees|pricing|how-to-buy|buy-crypto|faq|help|support|privacy|terms|zahlung|gebuhr|gebühr|preis")
PAGE_HINT_STRONG = re.compile(r"(?i)payment|deposit|withdraw|banking|cashier|fees|privacy|zahlung")


def domain_of(w):
    w = (w or "").strip().lower()
    if not w or " " in w:
        return ""
    if not re.match(r"^https?://", w):
        w = "https://" + w
    host = urllib.parse.urlsplit(w).hostname or ""
    host = re.sub(r"^www\d?\.", "", host)
    return host if "." in host else ""


def is_b2c(r):
    b = r.get("b2c")
    return b is True or (isinstance(b, str) and b.startswith("B2C"))


def sites_of(r):
    ws = list(r.get("websites") or [])
    if r.get("website"):
        ws += re.split(r"[|\s;,]+", r["website"])
    out = []
    for w in ws:
        d = domain_of(w)
        if d and d not in out:
            out.append(d)
    return out[:MAX_SITES_PER_COMPANY]


def wanted_domains():
    doms = {}
    for f in sorted((ROOT / "data").glob("*.json")):
        if f.name == OUT.name:
            continue
        try:
            d = json.loads(f.read_text())
        except Exception:
            continue
        if not isinstance(d, dict) or not isinstance(d.get("records"), list):
            continue
        for r in d["records"]:
            if isinstance(r, dict) and is_b2c(r) and r.get("active", True) is not False:
                for dom in sites_of(r):
                    doms.setdefault(dom, f.stem)
    return doms


def fetch(url, timeout=20):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read(3_000_000)
        enc = r.headers.get("Content-Encoding", "")
        if enc == "gzip":
            raw = gzip.decompress(raw)
        elif enc == "deflate":
            raw = zlib.decompress(raw)
        csp = r.headers.get("Content-Security-Policy", "") + " " + r.headers.get("Content-Security-Policy-Report-Only", "")
        cs = r.headers.get_content_charset() or "utf-8"
        return r.geturl(), raw.decode(cs, "replace"), csp


def scan(dom):
    found, pages, err = {}, [], ""

    def add(name, kind, how, where):
        e = found.setdefault(name, {"name": name, "kind": kind, "evidence": {}})
        rank = {"script": 3, "header": 2, "mention": 1}
        if rank[how] > rank.get(e.get("strength", ""), 0):
            e["strength"] = how
        e["evidence"].setdefault(how, where)

    def check(url, body, csp, legal):
        path = urllib.parse.urlsplit(url).path or "/"
        srcs = re.findall(r"""<(?:script|iframe|form|link)\b[^>]*?(?:src|action|href)\s*=\s*["']([^"']+)""", body, re.I)
        srcs += re.findall(r"""["'](https?://[^"'\s]+)["']""", body)[:4000]
        srcs = [s for s in srcs if domain_of(s) and domain_of(s) != dom and not domain_of(s).endswith("." + dom)]
        imgs = " ".join(re.sub(r"[-_ .]", "", v) for v in re.findall(r"""<img\b[^>]*?(?:src|alt|title)\s*=\s*["']([^"']+)""", body, re.I)).lower()
        text = html.unescape(re.sub(r"(?s)<(script|style|noscript)\b.*?</\1>|<[^>]+>", " ", body))
        for name, kind, dre, tre in PSPS:
            hit = next((s for s in srcs if dre.search(domain_of(s) + urllib.parse.urlsplit(s).path)), None)
            # links to a provider's site are mentions, scripts/iframes/forms loading from it are integrations
            if hit and re.search(r"""<(?:script|iframe|form)\b[^>]*?(?:src|action)\s*=\s*["']""" + re.escape(hit), body, re.I):
                add(name, kind, "script", path)
            elif hit and not re.search(r"""<a\b[^>]*href\s*=\s*["']""" + re.escape(hit), body, re.I):
                add(name, kind, "script", path)
            if csp and dre.search(csp):
                add(name, kind, "header", "content-security-policy")
            if legal or path == "/":
                if tre.search(text) or (name in LOGO_TOKEN and LOGO_TOKEN[name].search(imgs)):
                    add(name, kind, "mention", path)

    try:
        url, body, csp = fetch(f"https://{dom}/")
    except Exception as e:
        try:
            url, body, csp = fetch(f"https://www.{dom}/")
        except Exception as e2:
            return {"error": f"{type(e2).__name__}: {str(e2)[:120]}"}
    pages.append(urllib.parse.urlsplit(url).path or "/")
    check(url, body, csp, False)
    if re.search(r"(?i)just a moment|cf-chl|attention required|access denied", body[:5000]) and len(body) < 30000:
        err = "bot protection on homepage"
    links = []
    for href, label in re.findall(r"""<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>(.*?)</a>""", body, re.I | re.S):
        full = urllib.parse.urljoin(url, href)
        host = domain_of(full)
        if host != dom and not host.endswith("." + dom):
            continue
        key = href + " " + re.sub(r"<[^>]+>", "", label)
        if PAGE_HINT.search(key) and full not in links and full.rstrip("/") != url.rstrip("/"):
            links.append(full)
    links.sort(key=lambda u: 0 if PAGE_HINT_STRONG.search(u) else 1)
    for link in links[:MAX_PAGES - 1]:
        try:
            u, b, c = fetch(link, timeout=15)
            pages.append(urllib.parse.urlsplit(u).path or "/")
            check(u, b, c, True)
        except Exception:
            pass
    out = {"psps": sorted(found.values(), key=lambda e: ({"acquirer": 0, "on-ramp": 1, "open banking": 2, "wallet": 3}[e["kind"]], e["name"])),
           "pages": pages}
    if err and not found:
        out["error"] = err
    return out


def main():
    now = datetime.now(timezone.utc)
    old = {}
    if OUT.exists():
        old = json.loads(OUT.read_text()).get("domains", {})
    want = wanted_domains()
    cutoff = (now - timedelta(days=RESCAN_DAYS)).isoformat()
    # never-scanned first, then oldest
    todo = sorted(want, key=lambda d: old.get(d, {}).get("checked", ""))
    todo = [d for d in todo if old.get(d, {}).get("checked", "") < cutoff][:MAX_SCANS]
    print(f"{len(want)} B2C domains, {len(todo)} to scan", flush=True)
    domains = {d: old[d] for d in want if d in old}
    t0 = time.time()
    with cf.ThreadPoolExecutor(24) as ex:
        futs = {ex.submit(scan, d): d for d in todo}
        for i, f in enumerate(cf.as_completed(futs), 1):
            d = futs[f]
            try:
                res = f.result()
            except Exception as e:
                res = {"error": f"{type(e).__name__}: {str(e)[:120]}"}
            prev = old.get(d, {})
            # a failed rescan keeps the last good detection
            if res.get("error") and prev.get("psps"):
                res = {**prev, "last_error": res["error"]}
            res["checked"] = now.isoformat(timespec="seconds")
            res["source"] = want[d]
            domains[d] = res
            if os.environ.get("DEBUG") or i % 100 == 0:
                print(f"[{i}/{len(todo)} {time.time() - t0:.0f}s] {d}: {', '.join(p['name'] for p in res.get('psps', [])) or res.get('error', '-')}", flush=True)
    ok = sum(1 for v in domains.values() if not v.get("error"))
    hits = sum(1 for v in domains.values() if v.get("psps"))
    print(f"done: {len(domains)} domains, {ok} reachable, {hits} with a provider detected")
    if todo and ok < 0.2 * len(domains):
        print("too few sites reachable, keeping previous data", file=sys.stderr)
        sys.exit(1)
    OUT.write_text(json.dumps({"fetched_at": now.isoformat(timespec="seconds"), "domains": dict(sorted(domains.items()))},
                              ensure_ascii=False, separators=(",", ":")))


if __name__ == "__main__":
    main()
