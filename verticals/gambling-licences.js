window.VERTICALS = window.VERTICALS || [];
window.VERTICALS.push({
  id: "gambling",
  group: "Gaming & Lottery",
  title: "Gambling licence tracker",
  data: null,
  async render(el) {
    el.innerHTML = `<h1>Gambling licence tracker</h1><p class="sub">Loading regulator registers…</p>`;
    if (!this.data) this.data = await fetch("data/gambling.json", { cache: "no-cache" }).then(r => r.json());
    const D = this.data, R = D.records;
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    const cname = c => { try { return names.of(c); } catch { return c; } };
    const regs = D.regulators;
    const types = [...new Set(R.map(r => r.licence_type).filter(Boolean))].sort();
    const thisMonth = new Date().toISOString().slice(0, 7);
    const st = { q: "", reg: "", type: "", status: "active", from: "", to: "", sort: "granted", dir: -1 };
    const active = R.filter(r => r.active);

    el.innerHTML = `
      <h1>Gambling licence tracker</h1>
      <p class="sub">Licensed gambling operators across ${regs.length} regulators, newest first. Dates marked "first seen" come from registers that publish no grant date; Malta shows the year from the licence number.</p>
      <div class="stats">
        <div class="stat"><b>${active.length}</b><span>Active licences</span></div>
        <div class="stat"><b>${active.filter(r => r.date_kind !== "year" && (r.granted || "").startsWith(thisMonth)).length}</b><span>New this month</span></div>
        ${regs.map(g => `<div class="stat"><b>${active.filter(r => r.regulator === g.code).length}</b><span>${flagImg(g.country, cname(g.country))} ${esc(g.code)}</span></div>`).join("")}
      </div>
      <div class="filters">
        <input type="search" id="q" placeholder="Search company, brand, website, activity…">
        <select id="reg"><option value="">All regulators</option>${regs.map(g => `<option value="${g.code}">${esc(cname(g.country))} (${esc(g.code)})</option>`).join("")}</select>
        <select id="type"><option value="">All licence types</option>${types.map(t => `<option>${esc(t)}</option>`).join("")}</select>
        <select id="status"><option value="active">Active only</option><option value="">Include inactive</option></select>
        <input type="date" id="from" title="Granted from"><input type="date" id="to" title="Granted to">
        <button class="btn" id="csv">Export CSV</button>
      </div>
      <div class="tablewrap"><table><thead><tr>
        <th data-k="company">Company</th><th data-k="regulator">Regulator</th><th data-k="licence_type">Type</th><th data-k="granted">Date</th>
        <th>Activities</th><th>Licence no.</th><th data-k="status">Status</th><th>Websites</th>
      </tr></thead><tbody id="rows"></tbody></table></div>
      <p class="foot" id="foot"></p>`;

    const $ = id => el.querySelector("#" + id);
    const regOf = c => regs.find(g => g.code === c) || {};
    const filtered = () => {
      const q = st.q.toLowerCase();
      return R.filter(r =>
        (!st.reg || r.regulator === st.reg) && (!st.type || r.licence_type === st.type) && (!st.status || r.active) &&
        (!st.from || r.granted >= st.from) && (!st.to || (r.granted && r.granted <= st.to)) &&
        (!q || [r.company, r.brands.join(" "), r.websites.join(" "), r.activities.join(" "), r.licence_number, r.regulator, cname(r.jurisdiction)].join(" ").toLowerCase().includes(q))
      ).sort((a, b) => String(a[st.sort] || "").localeCompare(String(b[st.sort] || "")) * st.dir);
    };
    const fmt = d => d ? new Date(d + "T00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "<span class=muted>n/a</span>";
    const list = (arr, word, f) => !arr.length ? "" : arr.length <= 3 ? arr.map(f).join("<br>") :
      `<details><summary>${arr.length} ${word}</summary>${arr.map(f).join("<br>")}</details>`;
    const link = w => `<a href="${esc(/^https?:/.test(w) ? w : "https://" + w)}" target="_blank" rel="noopener">${esc(w.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}</a>`;
    const draw = () => {
      const rows = filtered();
      $("rows").innerHTML = rows.map(r => `<tr>
        <td><div class="co">${flagImg(r.hq || r.jurisdiction, cname(r.hq || r.jurisdiction))}<span>${esc(r.company)}${r.brands.length ? `<div class="muted small">${esc(r.brands.slice(0, 3).join(", "))}${r.brands.length > 3 ? ` +${r.brands.length - 3}` : ""}</div>` : ""}</span></div></td>
        <td class="small" style="white-space:nowrap">${flagImg(r.jurisdiction, cname(r.jurisdiction))} ${esc(r.regulator)}</td>
        <td style="white-space:nowrap">${r.licence_type ? `<span class="tag g-${esc(r.licence_type.split(" ")[0])}">${esc(r.licence_type)}</span>` : ""}</td>
        <td style="white-space:nowrap">${r.date_kind === "year" && r.granted ? r.granted.slice(0, 4) : fmt(r.granted)}${r.date_kind === "first_seen" && r.granted ? `<div class="muted small">first seen</div>` : ""}${r.expiry ? `<div class="muted small">expires ${fmt(r.expiry)}</div>` : ""}</td>
        <td class="small">${list(r.activities, "activities", esc)}</td>
        <td class="small" style="white-space:nowrap">${esc(r.licence_number)}</td>
        <td class="small">${r.active ? esc(r.status || "Active") : `<span class="muted">${esc(r.status || "Inactive")}</span>`}</td>
        <td class="small">${list(r.websites, "websites", link)}</td>
      </tr>`).join("") || `<tr><td colspan="8" class="muted">No matches</td></tr>`;
      $("foot").innerHTML = `${rows.length} of ${R.length} entries. Sources: ${regs.map(g => `<a href="${g.url}" target="_blank" rel="noopener">${esc(g.name)}</a>${g.note ? ` (${esc(g.note)})` : ""}`).join(", ")}. Refreshed ${new Date(D.fetched_at).toLocaleString("en-GB")}.`;
    };
    ["q", "reg", "type", "status", "from", "to"].forEach(k => $(k).addEventListener("input", e => { st[k] = e.target.value; draw(); }));
    el.querySelectorAll("th[data-k]").forEach(th => th.onclick = () => {
      st.dir = st.sort === th.dataset.k ? -st.dir : (th.dataset.k === "granted" ? -1 : 1); st.sort = th.dataset.k; draw();
    });
    $("csv").onclick = () => {
      const cols = ["company", "brands", "regulator", "jurisdiction", "licence_type", "granted", "date_kind", "expiry", "activities", "licence_number", "status", "websites"];
      const q = v => `"${String(Array.isArray(v) ? v.join("; ") : v ?? "").replace(/"/g, '""')}"`;
      const blob = new Blob([[cols.join(","), ...filtered().map(r => cols.map(c => q(r[c])).join(","))].join("\n")], { type: "text/csv" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "gambling-licences.csv"; a.click();
    };
    draw();
  },
});
