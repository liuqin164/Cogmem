import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";

const path = "/tmp/cogmem-baseline.db";
try { rmSync(path, { force: true }); } catch {}

const db = new Database(path);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA synchronous = NORMAL");
db.exec(`
  CREATE TABLE memory (
    id INTEGER PRIMARY KEY,
    project TEXT NOT NULL,
    content TEXT NOT NULL,
    emb BLOB,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);
db.exec(`CREATE VIRTUAL TABLE memory_fts USING fts5(content, content='memory', content_rowid='id')`);
db.exec(`
  CREATE TRIGGER memory_ai AFTER INSERT ON memory BEGIN
    INSERT INTO memory_fts(rowid, content) VALUES (new.id, new.content);
  END
`);

function pct(xs, p) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
function timeIt(fn, n = 20) {
  const xs = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    fn();
    xs.push(performance.now() - t);
  }
  return { p50: +pct(xs, 50).toFixed(2), p95: +pct(xs, 95).toFixed(2) };
}

const vecs = [];
const ins = db.prepare("INSERT INTO memory (id, project, content, emb) VALUES (?, ?, ?, ?)");
const t0 = performance.now();
db.transaction(() => {
  for (let i = 0; i < 1000; i++) {
    const e = new Float32Array(Array.from({ length: 8 }, (_, k) => Math.sin(i * 0.37 + k)));
    vecs.push(e);
    const txt = i % 3 === 0 ? `quarterly report ${i} revenue` : `random note ${i} alpha`;
    ins.run(i, `p${i % 4}`, txt, new Uint8Array(e.buffer));
  }
})();
const insertMs = performance.now() - t0;
console.log(`SQLite 1000 行写入 ${insertMs.toFixed(0)}ms (${(insertMs / 1000).toFixed(2)}ms/行)`);

const kwStmt = db.prepare("SELECT rowid FROM memory_fts WHERE memory_fts MATCH ? LIMIT 10");
const kw = timeIt(() => kwStmt.all("quarterly AND report"));

const q = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]);
const allStmt = db.prepare("SELECT id, emb FROM memory");
const vec = timeIt(() => {
  const rows = allStmt.all();
  const scored = rows.map((r) => {
    const e = new Float32Array(r.emb.buffer, r.emb.byteOffset, 8);
    let d = 0;
    for (let k = 0; k < 8; k++) d += (e[k] - q[k]) ** 2;
    return [r.id, d];
  });
  scored.sort((a, b) => a[1] - b[1]);
  return scored.slice(0, 10);
});

const scalarStmt = db.prepare("SELECT id FROM memory WHERE project = ? AND created_at > ? LIMIT 10");
const scalar = timeIt(() => scalarStmt.all("p2", "2000-01-01"));

console.log("keyword:", JSON.stringify(kw));
console.log("vector(brute-force JS):", JSON.stringify(vec));
console.log("scalar:", JSON.stringify(scalar));

const size = db.prepare("SELECT page_count * page_size AS b FROM pragma_page_count(), pragma_page_size()").get();
console.log("db size MB:", (size.b / 1048576).toFixed(2));
db.close();
