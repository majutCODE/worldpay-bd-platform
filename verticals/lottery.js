window.VERTICALS = window.VERTICALS || [];
(function () {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  const cname = c => { try { return names.of(c); } catch { return c; } };
  const fmt = d => d ? new Date(d + "T00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "<span class=muted>n/a</span>";
  const b2cTag = `<span class="tag b2c-B2C" style="margin-left:4px" title="Takes payments from consumers online">B2C</span>`;
  const link = w => `<a href="${esc(/^https?:/.test(w) ? w : "https://" + w)}" target="_blank" rel="noopener">${esc(w.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}</a>`;
  const list = (arr, word, f) => !arr.length ? "" : arr.length <= 3 ? arr.map(f).join("<br>") : `<details><summary>${arr.length} ${word}</summary>${arr.map(f).join("<br>")}</details>`;
  const csv = (rows, cols, file) => {
    const q = v => `"${String(Array.isArray(v) ? v.join("; ") : v ?? "").replace(/"/g, '""')}"`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([[cols.join(","), ...rows.map(r => cols.map(c => q(r[c])).join(","))].join("\n")], { type: "text/csv" }));
    a.download = file; a.click();
  };
  // Generic page: filters are {id, html, test(row, value)}; state holds each filter's value.
  function page(el, { title, sub, stats, filters, head, row, cols, file, foot, R }) {
    const st = Object.fromEntries(filters.map(f => [f.id, f.init || ""]));
    el.innerHTML = `<h1>${title}</h1><p class="sub">${sub}</p><div class="stats">${stats}</div>
      <div class="filters">${filters.map(f => f.html).join("")}<button class="btn" id="csv">Export CSV</button></div>
      <div class="tablewrap"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody id="rows"></tbody></table></div>
      <p class="foot" id="foot"></p>`;
    const $ = id => el.querySelector("#" + id);
    const filtered = () => R.filter(r => filters.every(f => !st[f.id] || f.test(r, st[f.id])));
    const draw = () => {
      const rows = filtered();
      $("rows").innerHTML = rows.map(row).join("") || `<tr><td colspan="${head.length}" class="muted">No matches</td></tr>`;
      $("foot").innerHTML = `${rows.length} of ${R.length} entries. ${foot}`;
    };
    filters.forEach(f => { $(f.id).value = st[f.id]; $(f.id).addEventListener("input", e => { st[f.id] = e.target.value; draw(); }); });
    $("csv").onclick = () => csv(filtered(), cols, file);
    draw();
  }
  const search = (ph, fields) => ({ id: "q", html: `<input type="search" id="q" placeholder="${ph}">`, test: (r, v) => fields(r).join(" ").toLowerCase().includes(v.toLowerCase()) });
  const dates = k => [
    { id: "from", html: `<input type="date" id="from" title="From">`, test: (r, v) => (r[k] || "") >= v },
    { id: "to", html: `<input type="date" id="to" title="To">`, test: (r, v) => r[k] && r[k] <= v },
  ];
  const sel = (id, label, opts, test, init) => ({ id, init, test, html: `<select id="${id}"><option value="">${label}</option>${opts.map(o => Array.isArray(o) ? `<option value="${esc(o[0])}">${esc(o[1])}</option>` : `<option>${esc(o)}</option>`).join("")}</select>` });
  const month = () => new Date().toISOString().slice(0, 7);

  // ---------- Lottery licences: lottery entries from the gambling registers ----------
  const LOTTO_ACT = /lotter/i, LOTTO_NAME = /lott|lotto|raffle|prize draw/i;
  const kind = r => r.activities.find(a => /^Society Lottery/i.test(a)) ? "Society lottery" : r.activities.find(a => /External Lottery Manager/i.test(a)) ? "External lottery manager" : "Lottery operator";
  let gcache = null;
  window.VERTICALS.push({
    id: "lottery", group: "Prize Draws & Lottery", title: "Lottery licences",
    async render(el) {
      el.innerHTML = `<h1>Lottery licence tracker</h1><p class="sub">Loading…</p>`;
      const D = gcache || (gcache = await fetch("data/gambling.json", { cache: "no-cache" }).then(r => r.json()));
      const R = D.records.filter(r => r.activities.some(a => LOTTO_ACT.test(a)) || LOTTO_NAME.test(r.company + " " + r.brands.join(" ")))
        .map(r => ({ ...r, kind: kind(r) })).sort((a, b) => String(b.granted).localeCompare(String(a.granted)));
      const regs = D.regulators.filter(g => R.some(r => r.regulator === g.code));
      const A = R.filter(r => r.active);
      page(el, {
        R, title: "Lottery licence tracker", file: "lottery-licences.csv",
        sub: "UKGC society lottery and external lottery manager licences, plus lottery operators on the Malta, Gibraltar and Poland registers, newest first. B2C marks remote licences selling to consumers online.",
        stats: `<div class="stat"><b>${A.length}</b><span>Active licences</span></div>
          <div class="stat"><b>${new Set(A.filter(r => r.b2c).map(r => r.company)).size}</b><span>B2C operators</span></div>
          <div class="stat"><b>${A.filter(r => r.kind === "External lottery manager").length}</b><span>External lottery managers</span></div>
          <div class="stat"><b>${A.filter(r => r.date_kind !== "year" && (r.granted || "").startsWith(month())).length}</b><span>New this month</span></div>
          ${regs.map(g => `<div class="stat"><b>${A.filter(r => r.regulator === g.code).length}</b><span>${flagImg(g.country, cname(g.country))} ${esc(g.code)}</span></div>`).join("")}`,
        filters: [
          search("Search company, brand, website…", r => [r.company, ...r.brands, ...r.websites, r.licence_number]),
          sel("reg", "All regulators", regs.map(g => [g.code, `${cname(g.country)} (${g.code})`]), (r, v) => r.regulator === v),
          sel("kind", "All lottery types", ["Society lottery", "External lottery manager", "Lottery operator"], (r, v) => r.kind === v),
          sel("ltype", "Remote and land-based", [...new Set(R.map(r => r.licence_type))].sort(), (r, v) => r.licence_type === v),
          sel("b2c", "B2C and B2B", [["b2c", "B2C only"]], r => r.b2c, "b2c"),
          sel("status", "Include inactive", [["active", "Active only"]], r => r.active, "active"),
          ...dates("granted"),
        ],
        head: ["Company", "Regulator", "Lottery type", "Licence", "Date", "Status", "Websites"],
        cols: ["company", "b2c", "brands", "regulator", "kind", "licence_type", "activities", "licence_number", "granted", "date_kind", "status", "websites"],
        row: r => `<tr>
          <td><div class="co">${flagImg(r.hq || r.jurisdiction, cname(r.hq || r.jurisdiction))}<span>${esc(r.company)}${r.b2c ? b2cTag : ""}${r.brands.length ? `<div class="muted small">${esc(r.brands.slice(0, 3).join(", "))}${r.brands.length > 3 ? ` +${r.brands.length - 3}` : ""}</div>` : ""}</span></div></td>
          <td class="small" style="white-space:nowrap">${flagImg(r.jurisdiction, cname(r.jurisdiction))} ${esc(r.regulator)}</td>
          <td class="small">${esc(r.kind)}</td>
          <td class="small"><span class="tag">${esc(r.licence_type)}</span><div class="muted">${esc(r.licence_number)}</div></td>
          <td style="white-space:nowrap">${r.date_kind === "year" && r.granted ? r.granted.slice(0, 4) : fmt(r.granted)}${r.date_kind === "first_seen" && r.granted ? `<div class="muted small">first seen</div>` : ""}</td>
          <td class="small">${r.active ? esc(r.status || "Active") : `<span class="muted">${esc(r.status || "Inactive")}</span>`}</td>
          <td class="small">${list(r.websites, "websites", link)}</td></tr>`,
        foot: `Source: ${regs.map(g => `<a href="${g.url}" target="_blank" rel="noopener">${esc(g.name)}</a>`).join(", ")}. Small society lotteries registered only with local councils are not included. Refreshed ${new Date(D.fetched_at).toLocaleString("en-GB")}.`,
      });
    },
  });

  // ---------- Prize draw operators ----------
  let pcache = null;
  window.VERTICALS.push({
    id: "prize-draws", group: "Prize Draws & Lottery", title: "Prize draw operators",
    async render(el) {
      el.innerHTML = `<h1>Prize draw operators</h1><p class="sub">Loading…</p>`;
      let D;
      try { D = pcache || (pcache = await fetch("data/prizedraws.json", { cache: "no-cache" }).then(r => r.json())); }
      catch { el.innerHTML = `<h1>Prize draw operators</h1><p class="sub">Data not available yet. It refreshes twice daily.</p>`; return; }
      const R = D.records;
      const ch = n => `https://find-and-update.company-information.service.gov.uk/company/${n}`;
      const web = r => `https://www.google.com/search?q=${encodeURIComponent((r.trading_as || r.company) + " competitions uk")}`;
      page(el, {
        R, title: "Prize draw operators", file: "prize-draw-operators.csv",
        sub: "UK online competition and prize draw operators, newest first. These run on a free entry route so hold no gambling licence. Code signatory means listed on the DCMS voluntary code for prize draw operators; new companies come from Companies House incorporations whose name and SIC code read like a competition site. All take consumer payments online (B2C).",
        stats: `<div class="stat"><b>${R.length}</b><span>Operators</span></div>
          <div class="stat"><b>${R.filter(r => r.signatory).length}</b><span>Code signatories</span></div>
          <div class="stat"><b>${R.filter(r => r.source === "CH").length}</b><span>New companies (2y)</span></div>
          <div class="stat"><b>${R.filter(r => (r.date || "").startsWith(month()) && r.date_kind !== "first_seen").length}</b><span>New this month</span></div>`,
        filters: [
          search("Search operator, company number, town…", r => [r.company, r.trading_as, r.company_number, r.address]),
          sel("src", "All sources", [["sig", "Code signatories"], ["CH", "New companies only"]], (r, v) => v === "sig" ? r.signatory : r.source === v),
          sel("sic", "All SIC codes", [...new Set(R.flatMap(r => r.sic))].sort(), (r, v) => r.sic.includes(v)),
          ...dates("date"),
        ],
        head: ["Operator", "Source", "Date", "Company no.", "SIC", "Registered address"],
        cols: ["company", "trading_as", "b2c", "signatory", "source", "date", "date_kind", "company_number", "incorporated", "sic", "address"],
        row: r => `<tr>
          <td><div class="co">${flagImg("GB", "United Kingdom")}<span><a href="${web(r)}" target="_blank" rel="noopener" title="Find website">${esc(r.trading_as || r.company)}</a>${b2cTag}${r.trading_as ? `<div class="muted small">${esc(r.company)}</div>` : ""}</span></div></td>
          <td class="small">${r.signatory ? `<span class="tag b2c-B2C-bank">Code signatory</span>` : `<span class="tag">New company</span>`}</td>
          <td style="white-space:nowrap">${fmt(r.date)}<div class="muted small">${{ added: "signed code", first_seen: "first seen", incorporated: "incorporated" }[r.date_kind] || ""}</div></td>
          <td class="small">${r.company_number ? `<a href="${ch(r.company_number)}" target="_blank" rel="noopener">${esc(r.company_number)}</a>` : ""}</td>
          <td class="small">${r.sic.map(esc).join("<br>")}</td>
          <td class="small">${esc(r.address)}</td></tr>`,
        foot: `Sources: ${D.sources.map(s => `<a href="${s.url}" target="_blank" rel="noopener">${esc(s.name)}</a>${s.note ? ` (${esc(s.note)})` : ""}`).join(", ")}. Refreshed ${new Date(D.fetched_at).toLocaleString("en-GB")}.`,
      });
    },
  });
})();
