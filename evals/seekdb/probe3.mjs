import { SQL } from "bun";

const sql = new SQL("mysql://root@127.0.0.1:2882/test");

console.log("== A. 方言能力 ==");
const checks = [];
async function check(name, fn) {
  try {
    await fn();
    checks.push([name, "OK"]);
  } catch (e) {
    checks.push([name, "FAIL: " + String(e.message).slice(0, 90)]);
  }
}

await check("ON DUPLICATE KEY UPDATE", async () => {
  await sql.unsafe("CREATE TABLE IF NOT EXISTS mem_test.d1 (id INT PRIMARY KEY, v INT)");
  await sql.unsafe("INSERT INTO mem_test.d1 VALUES (1,1) ON DUPLICATE KEY UPDATE v=v+1");
  await sql.unsafe("INSERT INTO mem_test.d1 VALUES (1,1) ON DUPLICATE KEY UPDATE v=v+1");
  const r = await sql`SELECT v FROM mem_test.d1 WHERE id=1`;
  if (Number(r[0].v) !== 2) throw new Error("upsert 未生效 v=" + r[0].v);
});

await check("JSON_EXTRACT", async () => {
  await sql.unsafe("CREATE TABLE IF NOT EXISTS mem_test.d2 (id INT PRIMARY KEY, j JSON)");
  await sql.unsafe(`INSERT INTO mem_test.d2 VALUES (1, '{"a":{"b":"x"}}') ON DUPLICATE KEY UPDATE j=VALUES(j)`);
  const r = await sql`SELECT JSON_UNQUOTE(JSON_EXTRACT(j, '$.a.b')) AS v FROM mem_test.d2 WHERE id=1`;
  if (r[0].v !== "x") throw new Error("json 取值异常: " + JSON.stringify(r[0]));
});

await check("触发器 + SIGNAL 约束", async () => {
  await sql.unsafe("DROP TRIGGER IF EXISTS mem_test.trg_d3");
  await sql.unsafe("CREATE TABLE IF NOT EXISTS mem_test.d3 (id INT PRIMARY KEY, project VARCHAR(16), note VARCHAR(16))");
  await sql.unsafe(`CREATE TRIGGER mem_test.trg_d3 BEFORE INSERT ON mem_test.d3 FOR EACH ROW
    BEGIN
      IF NEW.project = 'forbidden' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'project_scope_violation';
      END IF;
    END`);
  try {
    await sql.unsafe("INSERT INTO mem_test.d3 VALUES (1, 'forbidden', 'x')");
    throw new Error("触发器未拦截");
  } catch (e) {
    if (!String(e.message).includes("project_scope_violation")) throw new Error("错误码不符: " + e.message.slice(0, 80));
  }
});

await check("递归 CTE 多跳遍历", async () => {
  await sql.unsafe("CREATE TABLE IF NOT EXISTS mem_test.edge (src INT, dst INT)");
  await sql.unsafe("DELETE FROM mem_test.edge");
  await sql.unsafe("INSERT INTO mem_test.edge VALUES (1,2),(2,3),(3,4)");
  const r = await sql`WITH RECURSIVE walk (node, depth) AS (
      SELECT 1, 0
      UNION ALL
      SELECT e.dst, w.depth+1 FROM mem_test.edge e JOIN walk w ON e.src = w.node WHERE w.depth < 5
    ) SELECT MAX(depth) AS d FROM walk`;
  if (Number(r[0].d) !== 3) throw new Error("多跳深度异常: " + JSON.stringify(r[0]));
});

await check("FORK DATABASE", async () => {
  await sql.unsafe("FORK DATABASE mem_test TO mem_fork");
});

for (const [n, r] of checks) console.log(`  ${n}: ${r}`);

console.log("== B. 并发写（4 个连接同时写同一库）==");
await sql.unsafe("CREATE TABLE IF NOT EXISTS mem_test.conc (id BIGINT PRIMARY KEY, host VARCHAR(16))");
const clients = await Promise.all(
  Array.from({ length: 4 }, () => new SQL("mysql://root@127.0.0.1:2882/test"))
);
const t0 = performance.now();
let ok = 0, err = 0;
await Promise.all(
  clients.map(async (c, ci) => {
    for (let i = 0; i < 50; i++) {
      try {
        await c.unsafe(`INSERT INTO mem_test.conc VALUES (${ci * 1000 + i}, 'h${ci}')`);
        ok++;
      } catch (e) {
        err++;
        if (err === 1) console.log("  首个错误:", String(e.message).slice(0, 100));
      }
    }
  })
);
const concMs = performance.now() - t0;
const total = (await sql`SELECT COUNT(*) AS c FROM mem_test.conc`)[0].c;
console.log(`  4 连接 x 50 写: ok=${ok} err=${err} 总行数=${total} 耗时=${concMs.toFixed(0)}ms`);

console.log("== C. 进程与连接清理 ==");
for (const c of clients) await c.close();
await sql.close();
console.log("DONE");
