// Platform shell: each vertical registers itself in window.VERTICALS.
// To add a vertical, create verticals/<name>.js that pushes {id, group, title, render(el)} and add a <script> tag.
(function () {
  const side = document.getElementById("side"), view = document.getElementById("view");
  const groups = ["Crypto", "Gaming & Lottery", "Prize Draws & Lottery"];

  function nav() {
    const cur = location.hash.slice(2) || (window.VERTICALS[0] || {}).id;
    // Only groups with at least one vertical are shown.
    side.innerHTML = groups.map(g => {
      const items = window.VERTICALS.filter(v => v.group === g);
      return items.length ? `<h4>${g}</h4>` + items.map(v => `<a href="#/${v.id}" class="${v.id === cur ? "on" : ""}">${v.title}</a>`).join("") : "";
    }).join("");
    const v = window.VERTICALS.find(x => x.id === cur);
    if (v) v.render(view); else view.innerHTML = "<h1>Not found</h1>";
    side.classList.remove("open");
  }
  document.getElementById("menu").onclick = () => side.classList.toggle("open");
  window.addEventListener("hashchange", nav);
  nav();
})();

window.flagImg = function (code, title) {
  if (!code || code.length !== 2) return "";
  const c = code.toLowerCase();
  return `<img class="flag" loading="lazy" src="https://flagcdn.com/w40/${c}.png" alt="${code}" title="${title || code}">`;
};
window.esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
