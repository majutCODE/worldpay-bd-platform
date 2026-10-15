window.VERTICALS = window.VERTICALS || [];
window.VERTICALS.push({
  id: "mica",
  group: "Crypto",
  title: "Licences (MiCA)",
  data: null,
  async render(el) {
    el.innerHTML = `<h1>MiCA licence tracker</h1><p class="sub">Loading ESMA register…</p>`;
    if (!this.data) this.data = await fetch("data/mica.json", { cache: "no-cache" }).then(r => r.json());
    await Co.loadPsp();
    const D = this.data, R = D.records;
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    const cname = c => { try { return names.of(c); } catch { return c; } };
    const countries = [...new Set(R.map(r => r.home_state).filter(Boolean))].sort((a, b) => cname(a).localeCompare(cname(b)));
    const types = [...new Set(R.map(r => r.licence_type))];
    const thisMonth = new Date().toISOString().slice(0, 7);
    const today = new Date().toISOString().slice(0, 10);
    const NEW_DAYS = 14, newSince = new Date(Date.now() - NEW_DAYS * 864e5).toISOString().slice(0, 10);
    const isNew = r => r.added >= newSince;
    const st = { q: "", country: "", type: "licensed", b2c: "", psp: "", from: "", to: "", sort: "added", dir: -1 };

    el.innerHTML = `
      <h1>MiCA licence tracker</h1>
      <p class="sub">All MiCA entries from the ESMA interim register, ordered by when they were added to the register (NEW = added in the last 14 days). Non-compliant entities available in the type filter. B2C = authorised for crypto-for-fiat exchange or client trading (hover a badge for why). Payments shows providers detected on B2C websites. Click a company for its profile.</p>
      <div class="stats">
        <div class="stat"><b>${R.filter(r => r.licence_type === "CASP").length}</b><span>CASPs authorised</span></div>
        <div class="stat"><b>${R.filter(r => r.b2c === "B2C").length}</b><span>B2C platforms</span></div>
        <div class="stat"><b>${R.filter(r => r.licence_type === "EMT").length}</b><span>EMT issuers</span></div>
        <div class="stat"><b>${R.filter(r => r.licence_type === "ART").length}</b><span>ART issuers</span></div>
        <div class="stat"><b>${R.filter(r => isNew(r) && r.licence_type !== "Non-compliant").length}</b><span>New on register (14 days)</span></div>
        <div class="stat"><b>${countries.length}</b><span>Home states</span></div>
      </div>
      <div class="filters">
        <input type="search" id="q" placeholder="Search company, regulator, service…">
        <select id="country"><option value="">All countries</option>${countries.map(c => `<option value="${c}">${esc(cname(c))}</option>`).join("")}</select>
        <select id="type"><option value="licensed">All licences (CASP, EMT, ART)</option><option value="">Everything incl. non-compliant</option>${types.map(t => `<option>${t}</option>`).join("")}</select>
        <select id="b2c"><option value="">B2C and B2B</option><option value="B2C">B2C platforms</option><option value="B2C+">B2C platforms + banks</option><option value="B2C bank">B2C banks</option><option value="B2B">B2B / institutional</option></select>
        <select id="psp">${Co.options()}</select>
        <input type="date" id="from" title="Added from"><input type="date" id="to" title="Added to">
        <button class="btn" id="csv">Export CSV</button>
      </div>
      <div class="tablewrap"><table><thead><tr>
        <th data-k="company">Company</th><th data-k="licence_type">Type</th><th data-k="b2c">B2C</th><th data-k="added" title="Date the company appeared on the ESMA register">Added to register</th><th title="Detected on their website">Payments</th>
        <th data-k="home_state">Home state</th><th data-k="regulator">Regulator</th><th>Services</th><th>Passported to</th><th>Website</th>
      </tr></thead><tbody id="rows"></tbody></table></div>
      <p class="foot" id="foot"></p>`;

    const $ = id => el.querySelector("#" + id);
    const filtered = () => {
      const q = st.q.toLowerCase();
      return R.filter(r =>
        (!st.country || r.home_state === st.country) && (!st.type || (st.type === "licensed" ? r.licence_type !== "Non-compliant" : r.licence_type === st.type)) &&
        (!st.psp || Co.match(Co.sitesOf(r), st.psp)) && (!st.b2c || (st.b2c === "B2C+" ? r.b2c.startsWith("B2C") : r.b2c === st.b2c)) && (!st.from || r.added >= st.from) && (!st.to || r.added <= st.to) &&
        (!q || [r.company, r.brand, r.regulator, r.services.join(" "), cname(r.home_state)].join(" ").toLowerCase().includes(q))
      ).sort((a, b) => String(a[st.sort]).localeCompare(String(b[st.sort])) * st.dir);
    };
    const fmt = d => d ? new Date(d + "T00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "<span class=muted>n/a</span>";
    const draw = () => {
      const rows = filtered();
      $("rows").innerHTML = rows.map(r => `<tr>
        <td><div class="co">${flagImg(r.home_state, cname(r.home_state))}<span>${Co.link(r.company)}${r.brand && r.brand !== r.company ? `<div class="muted small">${esc(r.brand)}</div>` : ""}</span></div></td>
        <td><span class="tag ${r.licence_type}">${r.licence_type}</span></td>
        <td>${r.b2c ? `<span class="tag b2c-${r.b2c.replace(" ", "-")}" title="${esc(r.b2c_reason)}">${r.b2c === "B2C bank" ? "B2C bank" : r.b2c}</span>` : ""}</td>
        <td style="white-space:nowrap">${isNew(r) ? `<span class="tag new">NEW</span> ` : ""}${fmt(r.added)}${r.added_estimated ? `<span class="muted small" title="Already on the register when tracking started 8 Oct 2026; date is ESMA's last-update date"> est.</span>` : ""}${r.authorised ? `<div class="muted small">licence ${r.authorised > today ? "effective" : "dated"} ${fmt(r.authorised)}</div>` : ""}${r.licence_type === "Non-compliant" ? `<div class="muted small">warning issued</div>` : ""}</td>
        <td class="small">${r.b2c.startsWith("B2C") ? Co.cell(Co.sitesOf(r)) : ""}</td>
        <td>${esc(cname(r.home_state))}</td>
        <td class="small">${esc(r.regulator)}</td>
        <td class="small">${r.services.length ? `<details><summary>${r.services.length} service${r.services.length > 1 ? "s" : ""}</summary>${r.services.map(esc).join("<br>")}</details>` : (r.comments && !/^(n\/?a|none)$/i.test(r.comments) ? `<span class="muted">${esc(r.comments.slice(0, 140))}</span>` : "")}</td>
        <td>${r.passported.length >= 10 ? `<details class="small"><summary>${r.passported.length} countries</summary><div class="pp">${r.passported.map(c => flagImg(c, cname(c))).join("")}</div></details>` : `<div class="pp">${r.passported.map(c => flagImg(c, cname(c))).join("") || '<span class="muted small">None listed</span>'}</div>`}</td>
        <td class="small">${r.website ? ((w) => `<a href="${esc(/^https?:/.test(w) ? w : "https://" + w)}" target="_blank" rel="noopener">${esc(w.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}</a>`)(r.website.split(/[|\s;]+/)[0]) : ""}</td>
      </tr>`).join("") || `<tr><td colspan="10" class="muted">No matches</td></tr>`;
      $("foot").innerHTML = `${rows.length} of ${R.length} entries. Source: <a href="${D.source_url}" target="_blank" rel="noopener">${D.source}</a>, refreshed ${new Date(D.fetched_at).toLocaleString("en-GB")}.`;
    };
    ["q", "country", "type", "b2c", "psp", "from", "to"].forEach(k => $(k).addEventListener("input", e => { st[k] = e.target.value; draw(); }));
    el.querySelectorAll("th[data-k]").forEach(th => th.onclick = () => {
      st.dir = st.sort === th.dataset.k ? -st.dir : (th.dataset.k === "added" ? -1 : 1); st.sort = th.dataset.k; draw();
    });
    $("csv").onclick = () => {
      const cols = ["company", "brand", "licence_type", "b2c", "b2c_reason", "added", "authorised", "home_state", "regulator", "services", "passported", "website", "lei", "payment_providers"];
      const q = v => `"${String(Array.isArray(v) ? v.join("; ") : v ?? "").replace(/"/g, '""')}"`;
      const blob = new Blob([[cols.join(","), ...filtered().map(r => cols.map(c => q(c === "payment_providers" ? Co.text(Co.sitesOf(r)) : r[c])).join(","))].join("\n")], { type: "text/csv" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "mica-licences.csv"; a.click();
    };
    draw();
  },
});
