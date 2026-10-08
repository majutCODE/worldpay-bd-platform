"""Fetch upcoming crypto and gaming events in London and Amsterdam (Luma, Meetup, AffPapa) into data/events.json."""
import json, os, re, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "data" / "events.json"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      "Accept-Language": "en-GB,en;q=0.9"}
CITIES = {"London": {"luma": "discplace-QCcNk3HXowOR97j", "meetup": "gb--London", "country": "GB"},
          "Amsterdam": {"luma": "discplace-FC4SDMUVXiFtMOr", "meetup": "nl--Amsterdam", "country": "NL"}}
KEYWORDS = {
    "crypto": r"crypto|web3|blockchain|bitcoin|\bbtc\b|ethereum|\beth\b|solana|stablecoin|defi|\bnft|token|on-?chain|\bdao\b|mica\b|digital assets?|tokeni[sz]|layer ?2|\bzk\b|polygon|cardano|ripple|xrp",
    "gaming": r"igaming|i-gaming|gambling|betting|sportsbook|casino|lotter|prize draw|bookmaker|wager|affiliate.*gaming|gaming (?:compliance|regulat|operator|industry|summit|conference)",
}
SEARCH_TERMS = {"crypto": ["crypto", "web3", "blockchain", "bitcoin", "stablecoin"],
                "gaming": ["igaming", "gambling", "betting", "casino", "lottery"]}


def get_json(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={**UA, "Accept": "application/json"}), timeout=60) as r:
                return json.loads(r.read())
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(2 ** (i + 2))


def get_text(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:
            if i == tries - 1:
                raise
            time.sleep(2 ** (i + 2))


def classify(*texts):
    blob = " ".join(t or "" for t in texts).lower()
    return [v for v, rx in KEYWORDS.items() if re.search(rx, blob)]


def city_of(*texts):
    blob = " ".join(t or "" for t in texts).lower()
    return next((c for c in CITIES if c.lower() in blob), "")


def ev(**kw):
    e = {"title": "", "start": "", "end": "", "city": "", "venue": "", "url": "", "source": "", "organiser": "",
         "verticals": [], "online": False, "image": ""}
    e.update(kw)
    return e


# ---------- Luma ----------
def luma_event(entry, city_hint=""):
    e = entry.get("event", entry)
    geo = e.get("geo_address_info") or {}
    hosts = entry.get("hosts") or []
    cal = entry.get("calendar") or {}
    return ev(title=e.get("name", ""), start=e.get("start_at", ""), end=e.get("end_at", ""),
              city=city_of(geo.get("city"), geo.get("city_state"), geo.get("full_address")) or city_hint,
              venue=geo.get("address") or geo.get("full_address") or "", url="https://lu.ma/" + e.get("url", ""),
              source="Luma", organiser=cal.get("name") or ", ".join(h.get("name", "") for h in hosts[:2]),
              online=e.get("location_type") == "online", image=e.get("cover_url", ""),
              _text=" ".join([e.get("name", ""), cal.get("name", ""), cal.get("description_short", "") or ""]))


def luma_paged(params, limit=500):
    out, cursor = [], None
    while len(out) < limit:
        q = dict(params, pagination_limit=50)
        if cursor:
            q["pagination_cursor"] = cursor
        d = get_json("https://api.lu.ma/discover/get-paginated-events?" + urllib.parse.urlencode(q))
        out += d.get("entries", [])
        cursor = d.get("next_cursor")
        if not d.get("has_more") or not cursor:
            break
    return out


def luma():
    events = []
    for city, c in CITIES.items():
        for entry in luma_paged({"discover_place_api_id": c["luma"]}):
            events.append(luma_event(entry, city))
    # Category feed (global) catches crypto events not featured on the city page
    for entry in luma_paged({"discover_category_api_id": "cat-crypto"}, limit=1000):
        e = luma_event(entry)
        if e["city"]:
            e["_text"] += " crypto"
            events.append(e)
    # Free-text search for terms the city pages miss, gaming especially
    for vertical, terms in SEARCH_TERMS.items():
        for city, c in CITIES.items():
            for term in terms:
                try:
                    entries = luma_paged({"discover_place_api_id": c["luma"], "query": term}, limit=100)
                except Exception as e:
                    print(f"  luma search {term}/{city}: {e}", file=sys.stderr)
                    continue
                for entry in entries:
                    events.append(luma_event(entry, city))
    return events


# ---------- AffPapa iGaming events directory (event pages carry schema.org Event data) ----------
def affpapa():
    links, year = [], datetime.now(timezone.utc).year
    # The listing page only shows featured events; the sitemap lists every event page.
    todo = ["https://affpapa.com/sitemap_index.xml", "https://affpapa.com/sitemap.xml", "https://affpapa.com/wp-sitemap.xml"]
    seen_maps = set()
    while todo and len(seen_maps) < 40:
        sm = todo.pop(0)
        if sm in seen_maps:
            continue
        seen_maps.add(sm)
        try:
            xml = get_text(sm, tries=2)
        except Exception:
            continue
        for loc in re.findall(r"<loc>\s*([^<\s]+)\s*</loc>", xml):
            if loc.endswith(".xml"):
                if re.search(r"event", loc, re.I):
                    todo.insert(0, loc)
            elif re.match(r"https://affpapa\.com/events/[a-z0-9-]+/?$", loc) and loc not in links:
                yrs = [int(y) for y in re.findall(r"20\d\d", loc)]
                if not yrs or max(yrs) >= year:
                    links.append(loc)
    if not links:
        raise RuntimeError(f"no event pages found in sitemaps {sorted(seen_maps)}")
    events = []
    for l in links:
        try:
            page = get_text(l, tries=2)
        except Exception:
            continue
        data = {}
        for block in re.findall(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', page, re.S):
            try:
                j = json.loads(block)
            except ValueError:
                continue
            for item in (j.get("@graph", [j]) if isinstance(j, dict) else j):
                if isinstance(item, dict) and "Event" in str(item.get("@type", "")):
                    data = item
        title = data.get("name") or re.sub(r"\s*[|–-].*$", "", (re.search(r"<title>(.*?)</title>", page, re.S) or [None, ""])[1]).strip()
        loc = json.dumps(data.get("location", ""))
        start, end = data.get("startDate", ""), data.get("endDate", "")
        if not start:  # fall back to "12-14 May 2027" style text near the title
            m = re.search(r"(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s*,?\s*(20\d\d)", re.sub(r"<[^>]+>", " ", page))
            if m:
                start = datetime.strptime(f"{m.group(1)} {m.group(3)} {m.group(4)}", "%d %B %Y").strftime("%Y-%m-%dT09:00:00+00:00")
                end = datetime.strptime(f"{m.group(2) or m.group(1)} {m.group(3)} {m.group(4)}", "%d %B %Y").strftime("%Y-%m-%dT18:00:00+00:00")
        city = city_of(loc, title)
        if os.environ.get("DEBUG") and len(events) < 3:
            print("  affpapa sample", l, title, start, loc[:200])
        events.append(ev(title=title, start=start, end=end, city=city, venue=(data.get("location") or {}).get("name", "") if isinstance(data.get("location"), dict) else "",
                         url=l, source="AffPapa", organiser=(data.get("organizer") or {}).get("name", "") if isinstance(data.get("organizer"), dict) else "",
                         _text=title + " igaming"))
    print(f"  affpapa: {len(links)} event pages, {sum(bool(e['city']) for e in events)} in London/Amsterdam")
    return events


# ---------- Meetup (event search page embeds Apollo state in __NEXT_DATA__) ----------
def meetup():
    events = []
    for vertical, terms in SEARCH_TERMS.items():
        for city, c in CITIES.items():
            for term in terms:
                url = "https://www.meetup.com/find/?" + urllib.parse.urlencode({"keywords": term, "location": c["meetup"], "source": "EVENTS"})
                try:
                    page = get_text(url)
                except Exception as e:
                    print(f"  meetup {term}/{city}: {e}", file=sys.stderr)
                    continue
                m = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', page, re.S)
                if not m:
                    continue
                state = json.loads(m.group(1)).get("props", {}).get("pageProps", {}).get("__APOLLO_STATE__", {})
                for k, v in state.items():
                    if not k.startswith("Event:") or not isinstance(v, dict):
                        continue
                    venue = state.get((v.get("venue") or {}).get("__ref", ""), {}) if isinstance(v.get("venue"), dict) else {}
                    group = state.get((v.get("group") or {}).get("__ref", ""), {}) if isinstance(v.get("group"), dict) else {}
                    events.append(ev(title=v.get("title", ""), start=v.get("dateTime", ""), end=v.get("endTime", ""),
                                     city=city_of(venue.get("city")) or city, venue=venue.get("name", ""),
                                     url=v.get("eventUrl", ""), source="Meetup", organiser=group.get("name", ""),
                                     online=v.get("eventType") == "ONLINE", _text=v.get("title", "")))
    return events


def iso_utc(s):
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(timezone.utc).isoformat(timespec="minutes")
    except (ValueError, AttributeError):
        return ""


def main():
    now = datetime.now(timezone.utc).isoformat(timespec="minutes")
    raw, failures = [], []
    for name, fn in (("Luma", luma), ("Meetup", meetup), ("AffPapa", affpapa)):
        try:
            got = fn()
            print(f"{name}: {len(got)} raw events")
            raw += got
        except Exception as e:
            failures.append(f"{name}: {e}")
            print(f"FAIL {name}: {e}", file=sys.stderr)
    seen, events = set(), []
    for e in raw:
        e["start"], e["end"] = iso_utc(e["start"]), iso_utc(e["end"])
        e["verticals"] = classify(e.pop("_text", ""), e["title"])
        if re.search(r"forex|trading workshop|\btrader\b", e["title"], re.I):
            continue
        if not e["verticals"] or not e["city"] or not e["start"] or (e["end"] or e["start"]) < now:
            continue
        k = (e["title"].lower().strip(), e["start"][:10])
        if k in seen or e["url"] in seen:
            continue
        seen |= {k, e["url"]}
        events.append(e)
    events.sort(key=lambda e: e["start"])
    prev = []
    if OUT.exists():
        try:
            prev = json.loads(OUT.read_text()).get("events", [])
        except ValueError:
            pass
    if len(failures) == 3:
        sys.exit("FAIL: all sources failed; keeping existing data. " + "; ".join(failures))
    if prev and len(events) < len([p for p in prev if (p["end"] or p["start"]) >= now]) * 0.5 and failures:
        sys.exit("FAIL: event count halved with a source down; keeping existing data. " + "; ".join(failures))
    for v in KEYWORDS:
        print(v, sum(v in e["verticals"] for e in events), "events")
    for e in events[:15]:
        print("  ", e["start"][:10], e["city"], e["source"], e["verticals"], e["title"][:80])
    if prev == events:
        print("No event changes.")
    else:
        OUT.write_text(json.dumps({"fetched_at": now, "failures": failures, "events": events}, ensure_ascii=False, indent=1))
    if failures:
        sys.exit("FAIL: " + "; ".join(failures))


if __name__ == "__main__":
    main()
