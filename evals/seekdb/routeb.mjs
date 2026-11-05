import { SQL } from "bun";

const url = "mysql://root@127.0.0.1:2882/test";
const sql = new SQL(url);

function pct(xs, p) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

async function timeIt(fn, n = 20) {
  const xs = [];
  for (let i = 0; i < n; i++) {
    const t = performance.now();
    await fn();
    xs.push(performance.now() - t);
  }
  return { p50: +pct(xs, 50).toFixed(2), p95: +pct(xs, 95).toFixed(2) };
}

console.log("== 1. 连接 ==");
const v = await sql`SELECT @@version AS v`;
console.log("version:", v[0].v);

console.log("== 2. 建库建表 ==");
await sql.unsafe("DROP DATABASE IF EXISTS mem_test");
await sql.unsafe("CREATE DATABASE mem_test");
await sql.unsafe("USE mem_test");
await sql.unsafe(`
  CREATE TABLE memory (
    id BIGINT PRIMARY KEY,
    project VARCHAR(32) NOT NULL,
    content TEXT NOT NULL,
    emb VECTOR(8),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FULLTEXT INDEX ft_content (content),
    VECTOR INDEX vidx (emb) WITH (distance=l2, type=hnsw, lib=vsag)
  )
`);
console.log("table ok");

console.log("== 3. 批量写入 1000 条 ==");
const rows = [];
for (let i = 0; i < 1000; i++) {
  const e = Array.from({ length: 8 }, (_, k) => Math.sin(i * 0.37 + k).toFixed(4));
  const txt = i % 3 === 0 ? `quarterly report ${i} revenue` : `random note ${i} alpha`;
  rows.push(`(${i}, 'p${i % 4}', '${txt}', '[${e.join(",")}]')`);
}
const t0 = performance.now();
for (let i = 0; i < rows.length; i += 100) {
  await sql.unsafe(
    `INSERT INTO memory (id, project, content, emb) VALUES ${rows.slice(i, i + 100).join(",")}`
  );
}
const insertMs = performance.now() - t0;
console.log(`1000 行写入 ${insertMs.toFixed(0)}ms (${(insertMs / 1000).toFixed(2)}ms/行)`);

console.log("== 4. 即时一致性（写完立刻查）==");
const fresh = await sql`SELECT COUNT(*) AS c FROM memory WHERE content LIKE '%quarterly report 999%'`;
console.log("立即可见:", fresh[0].c);

console.log("== 5. 检索延迟 ==");
const kw = await timeIt(async () => {
  await sql`SELECT id FROM memory WHERE MATCH(content) AGAINST('quarterly report') LIMIT 10`;
});
const vec = await timeIt(async () => {
  await sql`SELECT id, l2_distance(emb, '[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8]') AS d FROM memory ORDER BY d APPROXIMATE LIMIT 10`;
});
const hyb = await timeIt(async () => {
  await sql`SELECT id, l2_distance(emb, '[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8]') AS d
            FROM memory
            WHERE MATCH(content) AGAINST('quarterly report') AND project = 'p1'
            ORDER BY d APPROXIMATE LIMIT 10`;
});
const fts = await timeIt(async () => {
  await sql`SELECT id FROM memory WHERE project='p2' AND created_at > '2000-01-01' LIMIT 10`;
});
console.log("keyword:", JSON.stringify(kw));
console.log("vector :", JSON.stringify(vec));
console.log("hybrid :", JSON.stringify(hyb));
console.log("scalar :", JSON.stringify(fts));

console.log("== 6. 事务回滚（治理相似：记忆+关系+审计）==");
await sql.unsafe("CREATE TABLE mem_test.mem_edge (id BIGINT PRIMARY KEY, src BIGINT, dst BIGINT)");
await sql.unsafe("CREATE TABLE mem_test.audit (id BIGINT AUTO_INCREMENT PRIMARY KEY, note VARCHAR(64))");
const before = (await sql`SELECT COUNT(*) AS c FROM mem_test.audit`)[0].c;
let threw = false;
try {
  await sql.begin(async (tx) => {
    await tx`INSERT INTO mem_test.mem_edge (id, src, dst) VALUES (90001, 1, 2)`;
    await tx`INSERT INTO mem_test.audit (note) VALUES ('governance-apply')`;
    throw new Error("simulated mid-transaction failure");
  });
} catch (e) {
  threw = true;
  console.log("捕获异常:", e.message);
}
const afterAudit = (await sql`SELECT COUNT(*) AS c FROM mem_test.audit`)[0].c;
const afterEdge = (await sql`SELECT COUNT(*) AS c FROM mem_test.mem_edge WHERE id=90001`)[0].c;
console.log(`回滚验证: threw=${threw} audit ${before}->${afterAudit} edge_rows=${afterEdge}`);

console.log("== 7. 跨库事务 ==");
await sql.unsafe("CREATE DATABASE IF NOT EXISTS mem_shared");
await sql.unsafe("CREATE TABLE IF NOT EXISTS mem_shared.publish (id BIGINT PRIMARY KEY, h CHAR(64))");
let crossOk = "unknown";
try {
  await sql.begin(async (tx) => {
    await tx`INSERT INTO mem_test.mem_edge (id, src, dst) VALUES (90002, 3, 4)`;
    await tx`INSERT INTO mem_shared.publish (id, h) VALUES (1, 'abc')`;
  });
  const a = (await sql`SELECT COUNT(*) AS c FROM mem_test.mem_edge WHERE id=90002`)[0].c;
  const b = (await sql`SELECT COUNT(*) AS c FROM mem_shared.publish WHERE id=1`)[0].c;
  crossOk = `local=${a} shared=${b}`;
} catch (e) {
  crossOk = "ERROR: " + e.message;
}
console.log("跨库事务:", crossOk);

console.log("== 8. 磁盘占用 ==");
const disk = await sql`SELECT table_name, ROUND((data_length+index_length)/1048576,2) AS mb
                       FROM information_schema.tables WHERE table_schema='mem_test'`;
console.log(JSON.stringify(disk));

await sql.close();
console.log("DONE");
