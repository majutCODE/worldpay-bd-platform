// Shared target lists, stored as one private Vercel Blob per list (lists/<id>.json).
// GET returns every list. POST {op, ...} changes one list; writes use the blob's ETag so concurrent edits retry instead of overwriting.
import { put, get, list, del, BlobPreconditionFailedError } from "@vercel/blob";

const STATUSES = ["To contact", "Contacted", "Meeting booked", "Opportunity", "Not a fit"];
const clean = (s, n = 200) => String(s ?? "").trim().slice(0, n);
const path = id => `lists/${id}.json`;

async function read(id) {
  const r = await get(path(id), { access: "private", useCache: false });
  if (!r || r.statusCode !== 200) return null;
  return { data: JSON.parse(await new Response(r.stream).text()), etag: r.blob.etag };
}
const write = (l, etag) => put(path(l.id), JSON.stringify(l), {
  access: "private", contentType: "application/json", addRandomSuffix: false, cacheControlMaxAge: 60,
  ...(etag ? { ifMatch: etag } : {}),
});

async function all() {
  const out = [];
  let cursor;
  do {
    const r = await list({ prefix: "lists/", cursor });
    out.push(...r.blobs);
    cursor = r.hasMore ? r.cursor : undefined;
  } while (cursor);
  const lists = await Promise.all(out.map(b => read(b.pathname.slice(6, -5)).then(x => x && x.data).catch(() => null)));
  return lists.filter(Boolean).sort((a, b) => b.updated.localeCompare(a.updated));
}

// Applies fn to the latest copy of a list, retrying if someone else saved in between.
async function change(id, fn) {
  for (let i = 0; i < 5; i++) {
    const cur = await read(id);
    if (!cur) throw Object.assign(new Error("List not found"), { status: 404 });
    const l = cur.data;
    fn(l);
    l.updated = new Date().toISOString();
    try { await write(l, cur.etag); return l; } catch (e) { if (!(e instanceof BlobPreconditionFailedError)) throw e; }
  }
  throw Object.assign(new Error("List is busy, try again"), { status: 409 });
}

const ops = {
  async create(b) {
    const name = clean(b.name, 80), owner = clean(b.by, 60);
    if (!name || !owner) throw Object.assign(new Error("Name and owner required"), { status: 400 });
    const now = new Date().toISOString();
    const l = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name, owner, notes: clean(b.notes, 1000), created: now, updated: now, items: [] };
    await write(l);
    return l;
  },
  update: b => change(b.id, l => { if (b.name) l.name = clean(b.name, 80); if (b.notes != null) l.notes = clean(b.notes, 1000); }),
  add: b => change(b.id, l => {
    for (const it of [].concat(b.items || [])) {
      const company = clean(it.company);
      if (!company || l.items.some(x => x.company.toLowerCase() === company.toLowerCase())) continue;
      l.items.push({ company, source: clean(it.source, 60), status: STATUSES[0], note: clean(it.note, 1000), by: clean(b.by, 60), added: new Date().toISOString() });
    }
  }),
  item: b => change(b.id, l => {
    const it = l.items.find(x => x.company === b.company);
    if (!it) return;
    if (STATUSES.includes(b.status)) it.status = b.status;
    if (b.note != null) it.note = clean(b.note, 1000);
    it.by = clean(b.by, 60) || it.by;
  }),
  remove: b => change(b.id, l => { l.items = l.items.filter(x => x.company !== b.company); }),
  async delete(b) { await del(path(b.id)); return { id: b.id, deleted: true }; },
};

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) return res.status(503).json({ error: "storage-not-connected" });
  try {
    if (req.method === "GET") return res.json({ lists: await all(), statuses: STATUSES });
    if (req.method !== "POST") return res.status(405).end();
    const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    if (!ops[b.op] || (b.op !== "create" && !/^[a-z0-9]+$/.test(String(b.id)))) return res.status(400).json({ error: "Bad request" });
    res.json(await ops[b.op](b));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
}
