// Shared company layer: payment provider detection (data/psp.json) and the company profile drawer.
// Verticals call Co.loadPsp() before drawing, Co.psp(sites) for a row, and link names with Co.link(name).
window.Co = (function () {
  const SOURCES = [
    { file: "data/mica.json", vertical: "Crypto (MiCA)" },
    { file: "data/gambling.json", vertical: "Gambling" },
    { file: "data/lottery.json", vertical: "Lottery & prize draws" },
  ];
  const COMPETITOR = ["Stripe", "Adyen", "Checkout.com", "Nuvei", "Paysafe", "Braintree", "Worldline", "Trust Payments", "Ecommpay", "Praxis", "Truevo",
    "Emerchantpay", "Global Payments", "Shift4", "Rapyd", "Fiserv", "Elavon", "Barclaycard", "Mollie", "Airwallex", "Mangopay", "Square", "SumUp"];
  const LEGAL = /\b(limited|ltd|plc|llp|lp|gmbh|ag|kg|se|sa|sas|sarl|s\.?a\.?r?\.?l?|b\.?v\.?|n\.?v\.?|srl|spa|s\.?p\.?a|sp\.? ?z ?o\.?o\.?|ab|oy|oyj|as|a\/s|aps|asa|llc|inc|corp|corporation|company|co|uab|ou|oü|kft|d\.?o\.?o\.?|eood|ood|ltda|holdings?|group|trading|the)\b\.?/g;
  let psp = null, pspAt = "", all = null;
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const cname = c => { try { return names.of(c); } catch { return c; } };

  const key = n => String(n || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ")
    .replace(LEGAL, " ").replace(/[^a-z0-9]+/g, " ").trim();
  const domainOf = w => {
    w = String(w || "").trim().toLowerCase();
    if (!w || / /.test(w)) return "";
    try { return new URL(/^https?:/.test(w) ? w : "https://" + w).hostname.replace(/^www\d?\./, ""); } catch { return ""; }
  };
  const sitesOf = r => [...new Set([...(r.websites || []), ...String(r.website || "").split(/[|\s;,]+/)].map(domainOf).filter(d => d.includes(".")))];

  async function loadPsp() {
    if (psp) return psp;
    try {
      const d = await fetch("data/psp.json", { cache: "no-cache" }).then(r => r.ok ? r.json() : { domains: {} });
      psp = d.domains || {}; pspAt = d.fetched_at || "";
    } catch { psp = {}; }
    return psp;
  }
  async function loadAll() {
    if (all) return all;
    const sets = await Promise.all(SOURCES.map(s => fetch(s.file, { cache: "no-cache" }).then(r => r.ok ? r.json() : null).catch(() => null)));
    all = [];
    sets.forEach((d, i) => (d && d.records || []).forEach(r => all.push({ ...r, _v: SOURCES[i].vertical, _k: key(r.company), _sites: sitesOf(r) })));
    return all;
  }

  // Providers for a list of websites: merged across domains, strongest evidence wins.
  function forSites(sites) {
    const out = {}; let scanned = false, errors = 0;
    for (const d of sites) {
      const e = psp && psp[d];
      if (!e) continue;
      scanned = true; if (e.error && !(e.psps || []).length) errors++;
      for (const p of e.psps || []) {
        const rank = { script: 3, header: 2, mention: 1 };
        if (!out[p.name] || rank[p.strength] > rank[out[p.name].strength]) out[p.name] = { ...p, domain: d };
      }
    }
    const list = Object.values(out);
    return { list, scanned, unreachable: scanned && errors === sites.filter(d => psp && psp[d]).length && !list.length };
  }
  const isAcq = p => p.kind === "acquirer" || p.kind === "on-ramp";
  const why = p => ({ script: "loaded on the site", header: "allowed in the site's security policy", mention: "named or shown on the site" }[p.strength]) +
    ` (${p.domain}${p.evidence && p.evidence[p.strength] && p.evidence[p.strength] !== "content-security-policy" ? p.evidence[p.strength] : ""})`;
  const badge = p => `<span class="tag psp ${p.name === "Worldpay" ? "wp" : COMPETITOR.includes(p.name) ? "comp" : ""} ${p.strength === "mention" ? "weak" : ""}" title="${esc(p.kind)}: ${esc(why(p))}">${esc(p.name)}</span>`;

  function cell(sites) {
    if (!sites.length) return `<span class="muted small">no website</span>`;
    const r = forSites(sites);
    if (!r.scanned) return `<span class="muted small">not scanned yet</span>`;
    if (r.unreachable) return `<span class="muted small" title="site blocked the scanner or was down">site unreachable</span>`;
    const acq = r.list.filter(isAcq), other = r.list.filter(p => !isAcq(p));
    return (acq.map(badge).join(" ") || `<span class="muted small">none found</span>`) +
      (other.length ? `<div class="muted small" title="${esc(other.map(p => p.name).join(", "))}">+ ${other.length} method${other.length > 1 ? "s" : ""}</div>` : "");
  }
  function options() {
    const seen = new Set();
    Object.values(psp || {}).forEach(e => (e.psps || []).forEach(p => isAcq(p) && seen.add(p.name)));
    return `<option value="">All payment providers</option><option value="@comp">Competitor acquirer found</option><option value="@wp">Worldpay found</option>` +
      `<option value="@none">No acquirer found</option>` + [...seen].sort().map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
  }
  function match(sites, f) {
    if (!f) return true;
    const r = forSites(sites), names = r.list.map(p => p.name);
    if (f === "@comp") return names.some(n => COMPETITOR.includes(n));
    if (f === "@wp") return names.includes("Worldpay");
    if (f === "@none") return r.scanned && !r.unreachable && !r.list.some(isAcq);
    return names.includes(f);
  }
  const text = sites => forSites(sites).list.map(p => p.name + (p.strength === "mention" ? " (mentioned)" : "")).join("; ");
  const link = n => `<a href="#" class="colink" data-co="${esc(n)}">${esc(n)}</a>`;

  // Profile drawer
  async function open(name) {
    let dlg = document.getElementById("profile");
    if (!dlg) {
      dlg = document.createElement("dialog"); dlg.id = "profile"; document.body.appendChild(dlg);
      dlg.addEventListener("click", e => { if (e.target === dlg || e.target.closest(".x")) dlg.close(); });
      dlg.addEventListener("click", e => { const a = e.target.closest(".colink"); if (a) { e.preventDefault(); open(a.dataset.co); } });
    }
    dlg.innerHTML = `<div class="pbody"><button class="x" aria-label="Close">✕</button><h2>${esc(name)}</h2><p class="muted">Loading…</p></div>`;
    if (!dlg.open) dlg.showModal();
    await Promise.all([loadAll(), loadPsp()]);
    const k = key(name);
    let recs = all.filter(r => r._k === k);
    const sites = [...new Set(recs.flatMap(r => r._sites))];
    // also pull in licences held under another name that share a website
    const extra = all.filter(r => r._k !== k && r._sites.some(s => sites.includes(s)));
    recs = recs.concat(extra);
    const allSites = [...new Set(recs.flatMap(r => r._sites))];
    const P = forSites(allSites);
    const acq = P.list.filter(isAcq), other = P.list.filter(p => !isAcq(p));
    const countries = [...new Set(recs.map(r => r.hq || r.home_state || r.jurisdiction).filter(Boolean))];
    const b2c = recs.some(r => r.b2c === true || String(r.b2c).startsWith("B2C"));
    const aliases = [...new Set(recs.map(r => r.company).filter(c => c !== name))];
    const brands = [...new Set(recs.flatMap(r => r.brands || (r.brand && r.brand !== r.company ? [r.brand] : [])))];
    const fmt = d => d ? new Date(d + "T00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "";
    const q = encodeURIComponent(name.replace(new RegExp(LEGAL.source, "gi"), " ").replace(/\s+/g, " ").trim() || name);
    const comp = acq.filter(p => COMPETITOR.includes(p.name)).map(p => p.name);
    const angle = acq.some(p => p.name === "Worldpay") ? "Worldpay already appears on their site: check for an existing relationship before outreach."
      : comp.length ? `Uses ${comp.join(" and ")}: pitch a direct comparison (approval rates, local acquiring, APMs, pricing).`
      : P.scanned && !P.unreachable ? "No acquirer visible on public pages: checkout is likely behind login. Ask who they process with." : "";

    dlg.innerHTML = `<div class="pbody">
      <button class="x" aria-label="Close">✕</button>
      <h2>${countries.map(c => flagImg(c, cname(c))).join(" ")} ${esc(name)} ${b2c ? `<span class="tag b2c-B2C">B2C</span>` : ""}</h2>
      ${aliases.length ? `<p class="muted small">Also licensed as ${aliases.map(link).join(", ")}</p>` : ""}
      ${brands.length ? `<p class="small"><b>Brands</b> ${esc(brands.slice(0, 20).join(", "))}${brands.length > 20 ? ` +${brands.length - 20}` : ""}</p>` : ""}
      <h3>Payments</h3>
      ${!allSites.length ? `<p class="muted">No website on the register, so nothing to scan.</p>`
        : !P.scanned ? `<p class="muted">Not scanned yet. The scanner runs daily.</p>`
        : P.unreachable ? `<p class="muted">Website blocked the scanner or was down at last scan.</p>`
        : `<p>${acq.length ? acq.map(badge).join(" ") : `<span class="muted">No acquirer or on-ramp found on public pages.</span>`}</p>
           ${other.length ? `<p class="small"><span class="muted">Payment methods:</span> ${other.map(badge).join(" ")}</p>` : ""}`}
      ${angle ? `<p class="angle">${esc(angle)}</p>` : ""}
      <p class="muted small">Solid badge: provider's code loads on the site. Faded badge: provider named or logo shown on a payment, FAQ or legal page. Hover for where.</p>
      <h3>Licences</h3>
      <div class="tablewrap"><table><thead><tr><th>Vertical</th><th>Regulator</th><th>Type</th><th>Date</th><th>Status</th><th>Licence no.</th></tr></thead><tbody>
      ${recs.map(r => `<tr><td class="small">${esc(r._v)}${r.company !== name ? `<div class="muted small">${esc(r.company)}</div>` : ""}</td>
        <td class="small">${flagImg(r.jurisdiction || r.home_state, cname(r.jurisdiction || r.home_state))} ${esc(r.regulator)}</td>
        <td class="small">${esc(r.licence_type || "")}</td>
        <td class="small" style="white-space:nowrap">${r.date_kind === "year" && r.granted ? r.granted.slice(0, 4) : fmt(r.granted || r.authorised)}</td>
        <td class="small">${r.active === false ? `<span class="muted">${esc(r.status || "Inactive")}</span>` : esc(r.status || "Active")}</td>
        <td class="small">${esc(r.licence_number || r.lei || "")}</td></tr>`).join("")}
      </tbody></table></div>
      <h3>Websites</h3>
      <p class="small">${allSites.map(d => `<a href="https://${esc(d)}" target="_blank" rel="noopener">${esc(d)}</a>`).join(" · ") || `<span class="muted">None listed</span>`}</p>
      <h3>People</h3>
      <p class="small">
        <a class="btn" href="https://www.linkedin.com/search/results/companies/?keywords=${q}" target="_blank" rel="noopener">Company on LinkedIn</a>
        <a class="btn" href="https://www.linkedin.com/search/results/people/?keywords=${q}%20payments" target="_blank" rel="noopener">Payments people</a>
        <a class="btn" href="https://www.linkedin.com/search/results/people/?keywords=${q}%20(CFO%20OR%20%22head%20of%20finance%22%20OR%20treasury)" target="_blank" rel="noopener">Finance leaders</a>
        ${countries.includes("GB") ? `<a class="btn" href="https://find-and-update.company-information.service.gov.uk/search/companies?q=${q}" target="_blank" rel="noopener">Companies House</a>` : ""}
      </p>
      <p class="muted small">LinkedIn does not allow its people data to be pulled into other sites, so these open a pre-filled LinkedIn search.${pspAt ? ` Payments last scanned ${new Date(pspAt).toLocaleDateString("en-GB")}.` : ""}</p>
    </div>`;
  }
  document.addEventListener("click", e => {
    const a = e.target.closest("main .colink");
    if (a) { e.preventDefault(); open(a.dataset.co); }
  });

  return { loadPsp, sitesOf, cell, options, match, text, link, open, key };
})();
