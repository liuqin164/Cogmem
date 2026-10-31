import { SQL } from "bun";

const sql = new SQL("mysql://root@127.0.0.1:2882/test");

// --- C4.1 类型归一化：DECIMAL / BIGINT / DATETIME 实际返回什么 ---
await sql.unsafe("CREATE TABLE IF NOT EXISTS mem_test.t_types (id BIGINT PRIMARY KEY, dec_col DECIMAL(10,2), dt DATETIME, j JSON)");
await sql.unsafe("DELETE FROM mem_test.t_types");
await sql.unsafe(`INSERT INTO mem_test.t_types VALUES (1, 12.34, '2026-10-22 10:00:00', '{"a":1}')`);

const raw = (await sql`SELECT id, dec_col, dt, j FROM mem_test.t_types WHERE id=1`)[0];
const describe = (v) =>
  v === null ? "null"
  : Buffer.isBuffer(v) ? `Buffer(${v.toString("utf8")})`
  : v instanceof Date ? `Date(${v.toISOString()})`
  : `${typeof v}(${JSON.stringify(v)})`;
console.log("== 原始类型 ==");
for (const [k, v] of Object.entries(raw)) console.log(`  ${k}: ${describe(v)}`);

// 归一化器
function normalize(row) {
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    if (Buffer.isBuffer(v)) {
      const s = v.toString("utf8");
      out[k] = /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : s;
    } else if (typeof v === "bigint") {
      out[k] = Number(v);
    } else if (v instanceof Date) {
      out[k] = v.getTime();
    } else {
      out[k] = v;
    }
  }
  return out;
}
const norm = normalize(raw);
console.log("== 归一化后 ==");
for (const [k, v] of Object.entries(norm)) console.log(`  ${k}: ${typeof v}(${JSON.stringify(v)})`);

// --- C4.2 USE 不粘池：证明必须全限定 ---
await sql.unsafe("CREATE DATABASE IF NOT EXISTS mem_other");
await sql.unsafe("CREATE TABLE IF NOT EXISTS mem_other.marker (id INT PRIMARY KEY)");
await sql.unsafe("INSERT IGNORE INTO mem_other.marker VALUES (1)");

await sql.unsafe("USE mem_other");
let sawMarker = "unknown";
try {
  const r = await sql`SELECT COUNT(*) AS c FROM marker`;
  sawMarker = `未报错 count=${r[0].c}`;
} catch (e) {
  sawMarker = "报错: " + String(e.message).slice(0, 60);
}
const qualified = await sql`SELECT COUNT(*) AS c FROM mem_other.marker`;
console.log("== USE 语义 ==");
console.log(`  USE 后查裸表名: ${sawMarker}`);
console.log(`  全限定查: count=${qualified[0].c}`);

// --- C4.3 事务必须绑定同一连接：并发下验证 ---
await sql.unsafe("CREATE TABLE IF NOT EXISTS mem_test.tx_probe (id INT PRIMARY KEY, v INT)");
await sql.unsafe("DELETE FROM mem_test.tx_probe");

let rollbackOk = false;
try {
  await sql.begin(async (tx) => {
    await tx`INSERT INTO mem_test.tx_probe VALUES (1, 1)`;
    // 同时用池做另一件事，模拟同进程并发
    await sql`SELECT 1`;
    await tx`INSERT INTO mem_test.tx_probe VALUES (2, 2)`;
    throw new Error("rollback");
  });
} catch {
  const n = (await sql`SELECT COUNT(*) AS c FROM mem_test.tx_probe`)[0].c;
  rollbackOk = Number(n) === 0;
  console.log("== 事务隔离 ==");
  console.log(`  事务内混用池连接后回滚: 剩余行数=${n} (${rollbackOk ? "OK" : "脏写"})`);
}

await sql.close();
console.log(rollbackOk ? "C4 PASS" : "C4 FAIL");
