// Target lists: save companies from any tracker into named lists.
// Lists and identity are kept in this browser only.
window.TL = (function () {
  let cache = null, statuses = [];
  const me = () => { try { return localStorage.getItem("tl-name") || ""; } catch { return ""; } };
  const setMe = n => { try { localStorage.setItem("tl-name", n); } catch {} };
  const ask = () => {
    let n = me();
    if (!n) { n = (prompt("Your name, shown on lists you create and companies you add:") || "").trim(); if (n) setMe(n); }
    return n;
  };
  // Lists are kept in this browser (localStorage); there is no shared backend yet.
  const STATUSES = ["To contact", "Contacted", "Meeting booked", "Opportunity", "Not a fit"];
  const KEY = "tl-lists";
  const clean = (v, n = 200) => String(v ?? "").trim().slice(0, n);
  // Dedupe key: case, punctuation and common legal suffixes ignored, so "Acme Ltd" matches "ACME Limited".
  const SUFFIX = /\b(ltd|limited|plc|inc|llc|llp|gmbh|ag|sa|sas|sarl|srl|spa|bv|nv|ab|as|oy|kft|sp z o o|s r o|co|corp|corporation|company|group|holdings?)$/;
  const key = v => { let k = String(v ?? "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim(), p;
    do { p = k; k = k.replace(SUFFIX, "").trim(); } while (k && k !== p);
    return k || String(v ?? "").trim().toLowerCase(); };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { throw new Error("This browser blocks saving (private mode?)"); } };
  async function load() {
    statuses = STATUSES;
    if (!cache) { try { cache = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { cache = []; } }
    return cache.sort((a, b) => b.updated.localeCompare(a.updated));
  }
  const ops = {
    create: b => { const now = new Date().toISOString(); const l = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name: clean(b.name, 80), owner: clean(b.by, 60), notes: "", created: now, updated: now, items: [] }; cache.unshift(l); return l; },
    update: (b, l) => { if (b.name) l.name = clean(b.name, 80); if (b.notes != null) l.notes = clean(b.notes, 1000); },
    add: (b, l) => { for (const it of [].concat(b.items || [])) {
      const company = clean(it.company);
      if (!company || l.items.some(x => key(x.company) === key(company))) continue;
      l.items.push({ company, source: clean(it.source, 60), status: STATUSES.includes(it.status) ? it.status : STATUSES[0], note: clean(it.note, 1000), by: clean(b.by, 60), added: new Date().toISOString() });
    } },
    item: (b, l) => { const it = l.items.find(x => x.company === b.company); if (!it) return; if (STATUSES.includes(b.status)) it.status = b.status; if (b.note != null) it.note = clean(b.note, 1000); },
    remove: (b, l) => { l.items = l.items.filter(x => x.company !== b.company); },
  };
  async function call(body) {
    await load();
    body = { ...body, by: me() };
    if (body.op === "create") { if (!clean(body.name) || !body.by) throw new Error("Name and owner required"); const l = ops.create(body); save(); return l; }
    const i = cache.findIndex(l => l.id === body.id);
    if (i < 0) throw new Error("List not found");
    if (body.op === "delete") { cache.splice(i, 1); save(); return { id: body.id, deleted: true }; }
    const l = cache[i];
    ops[body.op](body, l);
    l.updated = new Date().toISOString();
    save();
    return l;
  }
  const source = () => { const v = (window.VERTICALS || []).find(x => x.id === location.hash.slice(2).split("?")[0]); return v ? `${v.group} ${v.title}`.trim() : ""; };
  const addBtn = n => `<button class="tladd" data-co="${esc(n)}" title="Add to a target list">+</button>`;
  const fail = e => e.message;

  // "Add to list" picker, opened from the + next to any company name.
  async function picker(company, src) {
    if (!ask()) return;
    let dlg = document.getElementById("tlpick");
    if (!dlg) {
      dlg = document.createElement("dialog"); dlg.id = "tlpick"; document.body.appendChild(dlg);
      dlg.addEventListener("click", e => { if (e.target === dlg || e.target.closest(".x")) dlg.close(); });
    }
    dlg.innerHTML = `<div class="pbody"><button class="x" aria-label="Close">✕</button><h2>Add ${esc(company)}</h2><p class="muted">Loading lists…</p></div>`;
    if (!dlg.open) dlg.showModal();
    let lists;
    try { lists = await load(true); } catch (e) { dlg.querySelector("p").textContent = fail(e); return; }
    const mine = lists.filter(l => l.owner === me()), rest = lists.filter(l => l.owner !== me());
    const row = l => { const has = l.items.some(i => key(i.company) === key(company));
      return `<label class="tlrow"><input type="radio" name="tl" value="${l.id}" ${has ? "disabled" : ""}> <b>${esc(l.name)}</b> <span class="muted small">${esc(l.owner)} · ${l.items.length}${has ? " · already added" : ""}</span></label>`; };
    dlg.querySelector(".pbody").innerHTML = `<button class="x" aria-label="Close">✕</button><h2>Add ${esc(company)}</h2>
      <p class="muted small">From ${esc(src || "manual entry")}. Adding as ${esc(me())}.</p>
      <div class="tlpicks">${mine.length ? `<h3>Your lists</h3>${mine.map(row).join("")}` : ""}${rest.length ? `<h3>Other lists</h3>${rest.map(row).join("")}` : ""}
      <h3>New list</h3><label class="tlrow"><input type="radio" name="tl" value="@new" ${lists.length ? "" : "checked"}> <input id="tlnew" placeholder="List name, e.g. UK crypto Q4"></label></div>
      <input id="tlnote" placeholder="Note (optional)" class="tlnote">
      <p><button class="btn pri" id="tlgo">Add to list</button> <span id="tlmsg" class="muted small"></span></p>`;
    const $ = s => dlg.querySelector(s);
    $("#tlnew").addEventListener("focus", () => { $('input[value="@new"]').checked = true; });
    $("#tlgo").onclick = async () => {
      const pick = (dlg.querySelector("input[name=tl]:checked") || {}).value;
      if (!pick) return ($("#tlmsg").textContent = "Pick a list");
      $("#tlgo").disabled = true; $("#tlmsg").textContent = "Saving…";
      try {
        let id = pick;
        if (pick === "@new") {
          const name = $("#tlnew").value.trim();
          if (!name) throw new Error("Name the new list");
          id = (await call({ op: "create", name })).id;
        }
        const l = await call({ op: "add", id, items: [{ company, source: src, note: $("#tlnote").value }] });
        $(".pbody").innerHTML = `<button class="x" aria-label="Close">✕</button><h2>Added</h2><p>${esc(company)} is on <a href="#/target-lists?${l.id}" class="tlopen">${esc(l.name)}</a>.</p>`;
        $(".tlopen").onclick = () => dlg.close();
      } catch (e) { $("#tlmsg").textContent = fail(e); $("#tlgo").disabled = false; }
    };
  }
  // CSV import: parse, map columns, preview new / duplicate / skipped rows, then add.
  function parseCSV(text) {
    text = text.replace(/^\ufeff/, "");
    const first = text.split(/\r?\n/, 1)[0], d = [";", "\t", ","].reduce((a, c) => first.split(c).length > first.split(a).length ? c : a, ",");
    const rows = []; let row = [], f = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === d) { row.push(f); f = ""; }
      else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
      else f += c;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows.filter(r => r.some(v => v.trim()));
  }
  const FIELDS = [["company", "Company *", /^(company|company name|name|merchant|organisation|organization|account|account name|entity|legal name|brand|operator)$/],
    ["status", "Status", /^(status|stage)$/], ["note", "Note", /^(note|notes|comment|comments|description)$/], ["source", "Source", /^(source|origin|list|vertical)$/]];
  function importer(l, done) {
    let dlg = document.getElementById("tlimp");
    if (!dlg) {
      dlg = document.createElement("dialog"); dlg.id = "tlimp"; document.body.appendChild(dlg);
      dlg.addEventListener("click", e => { if (e.target === dlg || e.target.closest(".x")) dlg.close(); });
    }
    dlg.innerHTML = `<div class="pbody"><button class="x" aria-label="Close">✕</button><h2>Import CSV into ${esc(l.name)}</h2>
      <p class="muted small">Needs a header row and a company column. Status, note and source columns are optional. Duplicates of companies already on the list, or repeated in the file, are skipped.</p>
      <input type="file" id="tlfile" accept=".csv,.tsv,.txt,text/csv"><div id="tlmap"></div></div>`;
    if (!dlg.open) dlg.showModal();
    const $ = s => dlg.querySelector(s);
    $("#tlfile").onchange = async e => {
      const file = e.target.files[0]; if (!file) return;
      if (file.size > 5e6) return ($("#tlmap").innerHTML = `<p class="tlerr">File is over 5 MB.</p>`);
      const rows = parseCSV(await file.text());
      if (rows.length < 2) return ($("#tlmap").innerHTML = `<p class="tlerr">No data rows found. Check the file has a header row.</p>`);
      const head = rows[0].map(h => h.trim()), data = rows.slice(1);
      const map = {}; FIELDS.forEach(([f, , re]) => { const i = head.findIndex(h => re.test(h.toLowerCase())); map[f] = i; });
      const fname = file.name.replace(/\.[^.]+$/, "");
      const plan = () => {
        const seen = new Set(l.items.map(i => key(i.company))), out = { add: [], dup: [], skip: 0 };
        for (const r of data) {
          const get = f => map[f] >= 0 ? clean(r[map[f]]) : "", company = get("company");
          if (!company) { out.skip++; continue; }
          const k = key(company);
          if (seen.has(k)) { out.dup.push(company); continue; }
          seen.add(k);
          const st = STATUSES.find(s => s.toLowerCase() === get("status").toLowerCase());
          out.add.push({ company, status: st, note: get("note"), source: get("source") || `CSV: ${fname}` });
        }
        return out;
      };
      const draw = () => {
        const p = map.company >= 0 ? plan() : null;
        $("#tlmap").innerHTML = `<h3>Columns</h3>${FIELDS.map(([f, label]) => `<label class="tlrow"><span style="width:90px">${label}</span>
          <select data-f="${f}"><option value="-1">${f === "company" ? "Pick a column" : "Not used"}</option>${head.map((h, i) => `<option value="${i}" ${map[f] === i ? "selected" : ""}>${esc(h || `Column ${i + 1}`)}</option>`).join("")}</select></label>`).join("")}
          <h3>Preview</h3>${!p ? `<p class="tlerr">Pick which column holds the company name.</p>` : `
          <p><b>${p.add.length}</b> to add · <b>${p.dup.length}</b> duplicate${p.dup.length === 1 ? "" : "s"} skipped${p.skip ? ` · <b>${p.skip}</b> with no company skipped` : ""}</p>
          ${p.add.length ? `<p class="small muted">${p.add.slice(0, 8).map(i => esc(i.company)).join(", ")}${p.add.length > 8 ? ` and ${p.add.length - 8} more` : ""}</p>` : ""}
          ${p.dup.length ? `<details class="small"><summary>Duplicates</summary><p class="muted">${p.dup.slice(0, 50).map(esc).join(", ")}${p.dup.length > 50 ? "…" : ""}</p></details>` : ""}`}
          <p><button class="btn pri" id="tlimpgo" ${p && p.add.length ? "" : "disabled"}>Add ${p ? p.add.length : 0} to list</button> <span id="tlimsg" class="muted small"></span></p>`;
        dlg.querySelectorAll("select[data-f]").forEach(s => s.onchange = () => { map[s.dataset.f] = +s.value; draw(); });
        $("#tlimpgo").onclick = async () => {
          if (!ask()) return;
          $("#tlimpgo").disabled = true; $("#tlimsg").textContent = "Saving…";
          try {
            const before = l.items.length, n = await call({ op: "add", id: l.id, items: p.add });
            $(".pbody").innerHTML = `<button class="x" aria-label="Close">✕</button><h2>Imported</h2><p>Added ${n.items.length - before} compan${n.items.length - before === 1 ? "y" : "ies"} to ${esc(n.name)}.</p>`;
            done();
          } catch (e) { $("#tlimsg").textContent = fail(e); $("#tlimpgo").disabled = false; }
        };
      };
      draw();
    };
  }

  document.addEventListener("click", e => {
    const b = e.target.closest(".tladd");
    if (b) { e.preventDefault(); picker(b.dataset.co, source()); }
  });

  // Page
  function render(el) {
    const sel = () => location.hash.split("?")[1] || "";
    el.innerHTML = `<h1>Target lists</h1><p class="sub">Loading…</p>`;
    const st = { q: "", who: "", status: "" };
    const draw = lists => {
      const id = sel(), l = lists.find(x => x.id === id);
      const owners = [...new Set(lists.map(x => x.owner))].sort();
      const shown = lists.filter(x => (!st.who || (st.who === "@me" ? x.owner === me() : x.owner === st.who)) &&
        (!st.q || (x.name + " " + x.owner + " " + x.items.map(i => i.company).join(" ")).toLowerCase().includes(st.q.toLowerCase())));
      el.innerHTML = `
        <h1>Target lists</h1>
        <p class="sub">Saved in this browser only, so use Export CSV to share a list. Add companies with the <span class="tladd static">+</span> next to any name in the trackers, type them in, or use Import CSV on a list.</p>
        <div class="stats">
          <div class="stat"><b>${lists.length}</b><span>Lists</span></div>
          <div class="stat"><b>${lists.reduce((n, x) => n + x.items.length, 0)}</b><span>Companies</span></div>
          <div class="stat"><b>${owners.length}</b><span>Contributors</span></div>
          <div class="stat"><b>${lists.filter(x => x.owner === me()).length}</b><span>Yours${me() ? "" : " (set your name)"}</span></div>
        </div>
        <div class="tlgrid">
          <section>
            <div class="filters">
              <input type="search" id="q" placeholder="Search lists or companies…" value="${esc(st.q)}">
              <select id="who"><option value="">Everyone</option><option value="@me" ${st.who === "@me" ? "selected" : ""}>Mine</option>${owners.map(o => `<option ${st.who === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>
            </div>
            <div class="filters"><input id="newname" placeholder="New list name"><button class="btn pri" id="create">Create</button></div>
            <div class="tllists">${shown.map(x => `<a href="#/target-lists?${x.id}" class="tlcard ${x.id === id ? "on" : ""}"><b>${esc(x.name)}</b>
              <span class="muted small">${esc(x.owner)} · ${x.items.length} compan${x.items.length === 1 ? "y" : "ies"} · ${new Date(x.updated).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</span></a>`).join("") || `<p class="muted">No lists yet.</p>`}</div>
            <p class="foot">You are <b>${esc(me() || "not set")}</b> · <a href="#" id="rename">change</a></p>
          </section>
          <section id="detail">${l ? detail(l) : `<div class="tlempty muted">${lists.length ? "Pick a list to open it." : "Create the first list, or add a company from any tracker."}</div>`}</section>
        </div>`;
      const $ = s => el.querySelector(s);
      $("#q").addEventListener("input", e => { st.q = e.target.value; const p = e.target.selectionStart; draw(lists); const q = $("#q"); q.focus(); q.setSelectionRange(p, p); });
      $("#who").addEventListener("input", e => { st.who = e.target.value; draw(lists); });
      $("#rename").onclick = e => { e.preventDefault(); const n = (prompt("Your name:", me()) || "").trim(); if (n) { setMe(n); draw(lists); } };
      $("#create").onclick = act(async () => {
        const name = $("#newname").value.trim(); if (!name || !ask()) return;
        const n = await call({ op: "create", name }); location.hash = `#/target-lists?${n.id}`;
      });
      if (l) wire(l);
    };
    const act = fn => async () => { try { await fn(); } catch (e) { alert(fail(e)); } };
    const detail = l => {
      const items = l.items.filter(i => !st.status || i.status === st.status);
      return `<div class="tlhead"><div><h2>${esc(l.name)}</h2><p class="muted small">Owner ${esc(l.owner)} · created ${new Date(l.created).toLocaleDateString("en-GB")} · updated ${new Date(l.updated).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p></div>
        <div><button class="btn" id="imp">Import CSV</button> <button class="btn" id="csv">Export CSV</button> <button class="btn" id="copy">Copy link</button> ${l.owner === me() ? `<button class="btn" id="ren">Rename</button> <button class="btn danger" id="del">Delete</button>` : ""}</div></div>
        <textarea id="notes" class="tlnotes" placeholder="List notes: angle, territory, owner split…">${esc(l.notes)}</textarea>
        <div class="filters"><input id="addco" placeholder="Add a company by name"><button class="btn pri" id="add">Add</button>
          <select id="status"><option value="">All statuses</option>${statuses.map(s => `<option ${st.status === s ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></div>
        <div class="tablewrap"><table class="tltable"><thead><tr><th>Company</th><th>Status</th><th>Note</th><th>Source</th><th>Added</th><th></th></tr></thead><tbody>
        ${items.map((i, n) => `<tr data-co="${esc(i.company)}">
          <td><b>${Co.link(i.company, true)}</b></td>
          <td><select class="ist">${statuses.map(s => `<option ${s === i.status ? "selected" : ""}>${esc(s)}</option>`).join("")}</select></td>
          <td><input class="inote" value="${esc(i.note)}" placeholder="Add a note"></td>
          <td class="small">${esc(i.source || "Manual")}</td>
          <td class="small" style="white-space:nowrap">${esc(i.by)}<div class="muted">${new Date(i.added).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}</div></td>
          <td><button class="btn rm" title="Remove">✕</button></td></tr>`).join("") || `<tr><td colspan="6" class="muted">No companies yet. Use the + next to a name in any tracker.</td></tr>`}
        </tbody></table></div>`;
    };
    const wire = l => {
      const $ = s => el.querySelector(s), redraw = () => draw(cache);
      $("#status").addEventListener("input", e => { st.status = e.target.value; redraw(); });
      $("#notes").addEventListener("change", act(async () => { await call({ op: "update", id: l.id, notes: $("#notes").value }); }));
      $("#add").onclick = act(async () => {
        const c = $("#addco").value.trim(); if (!c || !ask()) return;
        await call({ op: "add", id: l.id, items: [{ company: c, source: "Manual" }] }); redraw();
      });
      $("#addco").addEventListener("keydown", e => { if (e.key === "Enter") $("#add").click(); });
      $("#imp").onclick = () => importer(l, redraw);
      $("#copy").onclick = () => navigator.clipboard.writeText(location.href).then(() => ($("#copy").textContent = "Copied"));
      $("#csv").onclick = () => {
        const cols = ["company", "status", "note", "source", "by", "added"], q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const blob = new Blob([[cols.join(","), ...l.items.map(i => cols.map(c => q(i[c])).join(","))].join("\n")], { type: "text/csv" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = l.name.replace(/\W+/g, "-").toLowerCase() + ".csv"; a.click();
      };
      if ($("#ren")) $("#ren").onclick = act(async () => { const n = (prompt("List name:", l.name) || "").trim(); if (n) { await call({ op: "update", id: l.id, name: n }); redraw(); } });
      if ($("#del")) $("#del").onclick = act(async () => { if (confirm(`Delete "${l.name}"?`)) { await call({ op: "delete", id: l.id }); location.hash = "#/target-lists"; } });
      el.querySelectorAll("tr[data-co]").forEach(tr => {
        const company = tr.dataset.co;
        tr.querySelector(".ist").addEventListener("change", act(async e => { await call({ op: "item", id: l.id, company, status: tr.querySelector(".ist").value }); }));
        tr.querySelector(".inote").addEventListener("change", act(async () => { await call({ op: "item", id: l.id, company, note: tr.querySelector(".inote").value }); }));
        tr.querySelector(".rm").onclick = act(async () => { if (confirm(`Remove ${company}?`)) { await call({ op: "remove", id: l.id, company }); redraw(); } });
      });
    };
    load(true).then(draw).catch(e => {
      el.innerHTML = `<h1>Target lists</h1><p class="sub">${esc(fail(e))}</p>`;
    });
  }

  window.VERTICALS.push({ id: "target-lists", group: "Team", title: "Target lists", render });
  return { addBtn, picker };
})();
