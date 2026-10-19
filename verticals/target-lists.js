// Shared target lists: BDs and SDRs save companies from any tracker into named lists everyone can see.
// Data lives in /api/lists (Vercel Blob). Identity is a name saved in this browser.
window.TL = (function () {
  let cache = null, statuses = [];
  const me = () => { try { return localStorage.getItem("tl-name") || ""; } catch { return ""; } };
  const setMe = n => { try { localStorage.setItem("tl-name", n); } catch {} };
  const ask = () => {
    let n = me();
    if (!n) { n = (prompt("Your name, shown to the team on lists you create and companies you add:") || "").trim(); if (n) setMe(n); }
    return n;
  };
  async function load(force) {
    if (cache && !force) return cache;
    const r = await fetch("api/lists", { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Could not load lists");
    statuses = d.statuses || [];
    return (cache = d.lists);
  }
  async function call(body) {
    const r = await fetch("api/lists", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, by: me() }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Save failed");
    if (cache) {
      const i = cache.findIndex(l => l.id === (d.id || body.id));
      if (d.deleted) cache.splice(i, 1); else if (i >= 0) cache[i] = d; else cache.unshift(d);
    }
    return d;
  }
  const source = () => { const v = (window.VERTICALS || []).find(x => x.id === location.hash.slice(2).split("?")[0]); return v ? `${v.group} ${v.title}`.trim() : ""; };
  const addBtn = n => `<button class="tladd" data-co="${esc(n)}" title="Add to a target list">+</button>`;
  const fail = e => e.message === "storage-not-connected" ? "Target list storage is not connected yet." : e.message;

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
    const row = l => { const has = l.items.some(i => i.company.toLowerCase() === company.toLowerCase());
      return `<label class="tlrow"><input type="radio" name="tl" value="${l.id}" ${has ? "disabled" : ""}> <b>${esc(l.name)}</b> <span class="muted small">${esc(l.owner)} · ${l.items.length}${has ? " · already added" : ""}</span></label>`; };
    dlg.querySelector(".pbody").innerHTML = `<button class="x" aria-label="Close">✕</button><h2>Add ${esc(company)}</h2>
      <p class="muted small">From ${esc(src || "manual entry")}. Adding as ${esc(me())}.</p>
      <div class="tlpicks">${mine.length ? `<h3>Your lists</h3>${mine.map(row).join("")}` : ""}${rest.length ? `<h3>Team lists</h3>${rest.map(row).join("")}` : ""}
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
        <p class="sub">Shared with every BD and SDR. Add companies with the <span class="tladd static">+</span> next to any name in the trackers, or type them in below.</p>
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
        <div><button class="btn" id="csv">Export CSV</button> <button class="btn" id="copy">Copy link</button> ${l.owner === me() ? `<button class="btn" id="ren">Rename</button> <button class="btn danger" id="del">Delete</button>` : ""}</div></div>
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
      $("#copy").onclick = () => navigator.clipboard.writeText(location.href).then(() => ($("#copy").textContent = "Copied"));
      $("#csv").onclick = () => {
        const cols = ["company", "status", "note", "source", "by", "added"], q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const blob = new Blob([[cols.join(","), ...l.items.map(i => cols.map(c => q(i[c])).join(","))].join("\n")], { type: "text/csv" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = l.name.replace(/\W+/g, "-").toLowerCase() + ".csv"; a.click();
      };
      if ($("#ren")) $("#ren").onclick = act(async () => { const n = (prompt("List name:", l.name) || "").trim(); if (n) { await call({ op: "update", id: l.id, name: n }); redraw(); } });
      if ($("#del")) $("#del").onclick = act(async () => { if (confirm(`Delete "${l.name}" for everyone?`)) { await call({ op: "delete", id: l.id }); location.hash = "#/target-lists"; } });
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
