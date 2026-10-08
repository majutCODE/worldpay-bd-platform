window.VERTICALS = window.VERTICALS || [];
(function () {
  const CC = { London: "GB", Amsterdam: "NL" };
  let cache = null;
  const load = () => cache || (cache = fetch("data/events.json", { cache: "no-cache" }).then(r => r.json()));

  function render(el, vertical, label) {
    el.innerHTML = `<h1>${label} events</h1><p class="sub">Loading events…</p>`;
    load().then(D => {
      const now = new Date().toISOString();
      const R = D.events.filter(e => e.verticals.includes(vertical) && (e.end || e.start) >= now);
      const week = new Date(Date.now() + 7 * 864e5).toISOString();
      const sources = [...new Set(R.map(e => e.source))].sort();
      const st = { q: "", city: "", source: "", from: "", to: "" };
      el.innerHTML = `
        <h1>${label} events</h1>
        <p class="sub">Upcoming ${label.toLowerCase()} events in London and Amsterdam from Luma, Meetup and AffPapa, soonest first.</p>
        <div class="stats">
          <div class="stat"><b>${R.length}</b><span>Upcoming</span></div>
          <div class="stat"><b>${R.filter(e => e.start <= week).length}</b><span>Next 7 days</span></div>
          ${Object.keys(CC).map(c => `<div class="stat"><b>${R.filter(e => e.city === c).length}</b><span>${flagImg(CC[c], c)} ${c}</span></div>`).join("")}
        </div>
        <div class="filters">
          <input type="search" id="q" placeholder="Search event, organiser, venue…">
          <select id="city"><option value="">All cities</option>${Object.keys(CC).map(c => `<option>${c}</option>`).join("")}</select>
          <select id="source"><option value="">All sources</option>${sources.map(s => `<option>${esc(s)}</option>`).join("")}</select>
          <input type="date" id="from" title="From"><input type="date" id="to" title="To">
          <button class="btn" id="csv">Export CSV</button>
        </div>
        <div class="tablewrap"><table><thead><tr>
          <th>Date</th><th>Event</th><th>City</th><th>Venue</th><th>Source</th>
        </tr></thead><tbody id="rows"></tbody></table></div>
        <p class="foot" id="foot"></p>`;
      const $ = id => el.querySelector("#" + id);
      const filtered = () => {
        const q = st.q.toLowerCase();
        return R.filter(e => (!st.city || e.city === st.city) && (!st.source || e.source === st.source) &&
          (!st.from || e.start.slice(0, 10) >= st.from) && (!st.to || e.start.slice(0, 10) <= st.to) &&
          (!q || [e.title, e.organiser, e.venue].join(" ").toLowerCase().includes(q)));
      };
      const tz = c => c === "Amsterdam" ? "Europe/Amsterdam" : "Europe/London";
      const when = e => {
        const d = new Date(e.start), o = { timeZone: tz(e.city) };
        return `${d.toLocaleDateString("en-GB", { ...o, weekday: "short", day: "2-digit", month: "short", year: "numeric" })}<div class="muted small">${d.toLocaleTimeString("en-GB", { ...o, hour: "2-digit", minute: "2-digit" })}</div>`;
      };
      const draw = () => {
        const rows = filtered();
        $("rows").innerHTML = rows.map(e => `<tr>
          <td style="white-space:nowrap">${when(e)}</td>
          <td><a href="${esc(e.url)}" target="_blank" rel="noopener"><b>${esc(e.title)}</b></a>${e.organiser ? `<div class="muted small">${esc(e.organiser)}</div>` : ""}</td>
          <td style="white-space:nowrap">${flagImg(CC[e.city], e.city)} ${esc(e.city)}</td>
          <td class="small">${e.online ? "Online" : esc(e.venue)}</td>
          <td class="small">${esc(e.source)}</td>
        </tr>`).join("") || `<tr><td colspan="5" class="muted">No upcoming events</td></tr>`;
        $("foot").innerHTML = `${rows.length} of ${R.length} events. Refreshed ${new Date(D.fetched_at).toLocaleString("en-GB")}.`;
      };
      ["q", "city", "source", "from", "to"].forEach(k => $(k).addEventListener("input", ev => { st[k] = ev.target.value; draw(); }));
      $("csv").onclick = () => {
        const cols = ["start", "title", "organiser", "city", "venue", "source", "url"];
        const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
        const blob = new Blob([[cols.join(","), ...filtered().map(e => cols.map(c => q(e[c])).join(","))].join("\n")], { type: "text/csv" });
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${vertical}-events.csv`; a.click();
      };
      draw();
    });
  }

  window.VERTICALS.push(
    { id: "crypto-events", group: "Crypto", title: "Events", render(el) { render(el, "crypto", "Crypto"); } },
    { id: "gaming-events", group: "Gaming & Lottery", title: "Events", render(el) { render(el, "gaming", "Gaming"); } },
    { id: "lottery-events", group: "Prize Draws & Lottery", title: "Events", render(el) { render(el, "lottery", "Lottery and prize draw"); } },
  );
})();
