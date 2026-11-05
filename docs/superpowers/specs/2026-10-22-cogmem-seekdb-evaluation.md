# Cogmem 4.0: seekdb 可行性评估

日期: 2026-10-22
评估对象: Cogmem 3.7.5 (commit c52508c) → seekdb 1.4.0.0
运行环境: aarch64 Linux, kernel 6.17.0-1016-oracle, 23 GB RAM, Bun 1.3.14, Node v24.16.0

## 结论

**有条件采用 seekdb。**

关键能力全部实测通过：Bun 原生 SQL 直连、跨库原子事务、事务回滚、四连接并发写、向量与全文混合检索、递归 CTE 多跳、触发器约束、全新目录冷启动 2.5 秒。

剩余三个必须关闭的条件：

| # | 条件 | 当前状态 |
|---|---|---|
| C1 | 首次冷启动可接受 | **已关闭**：全新目录两次实测 2.517 s，RSS 264 / 345 MB |
| C2 | 设计不得依赖 FORK/MERGE | 已确认不可用（含触发器的库无法 fork），设计必须移除该依赖 |
| C3 | x86_64 与 macOS 二进制验证 | 未验证，仅 aarch64 Linux 通过 |
| C4 | Bun SQL 类型与连接语义固化 | **已关闭**：归一化函数与"禁止依赖 USE"规则已实现并验证（`c4-bun-semantics.mjs`，C4 PASS） |

---

## 交付物 1: 现状审查

### 1.1 数据访问面（实测计数）

| 项 | 数量 |
|---|---|
| 导入 `bun:sqlite` 的文件 | 81 |
| `new Database(...)` | 31 |
| `.prepare(...)` | 1,249 |
| `.exec(...)` | 294 |
| 同步结果调用（`.all/.get/.run/.iterate`） | 1,472 |
| `db.transaction(fn)` 同步回调 | 85 |
| `PRAGMA` 语句 | 68 |
| FTS5 / `MATCH` | 136 |
| `CREATE TRIGGER` | 57 |
| `RAISE(ABORT)` | 20 |
| 迁移文件 | 33 |
| `sqlite-vec` / `hnswlib` 引用 | 22 |
| 测试文件触碰驱动 | 50 |

### 1.2 事务边界

事务全部通过 `db.transaction(fn)` 同步回调表达，共 85 处。典型形态：

```ts
const transaction = this.db.transaction(() => {
  // 多条写操作
});
transaction.immediate?.();
```

语义特征：回调是同步的，返回值直接可用，异常自动回滚。改为异步后，回调变成 `async`，调用点必须 `await`，且事务必须绑定到单一连接（连接池下这是新的失效点）。

### 1.3 SQLite 特有功能（必须重写）

| 构造 | 出现次数 | 用途 |
|---|---|---|
| `ON CONFLICT ... DO UPDATE` | 141 | upsert |
| `INSERT OR IGNORE/REPLACE` | 75 | 幂等写入 |
| `json_extract` | 47 | 结构化字段查询 |
| `PRAGMA table_info` | 45 | 迁移期结构自省 |
| `PRAGMA busy_timeout` | 11 | 并发等待 |
| `PRAGMA foreign_keys` | 7 | 外键约束 |
| `FTS5` 虚拟表 | 136 | 全文检索 |
| 触发器（含 RAISE 约束） | 57 | 作用域不变量 |

### 1.4 受影响模块（行数）

| 模块 | 文件 | 行数 |
|---|---|---|
| store | 35 | 13,429 |
| recall | 16 | 2,553 |
| retrieval | 16 | 2,796 |
| atlas | 11 | 2,759 |
| governance | 13 | 1,122 |
| core | 10 | 2,350 |
| 其余 | 30+ | 约 6,000 |

### 1.5 结论

这是一次持久层重写，不是驱动替换。受影响的核心是 `src/store` 的 35 个文件，但异步化会沿调用链传导到 recall、atlas、governance、MCP 工具和 CLI。

---

## 交付物 2: seekdb 可行性

### 2.1 版本与分发

| 项 | 实测值 |
|---|---|
| 服务端版本 | `5.7.25-OceanBase seekdb-v1.4.0.0` (OceanBase 4.3.5.3) |
| Node 绑定包 | `@oceanbase/seekdb-node` + 平台包 `seekdb-node-linux-arm64-gnu` |
| 平台包体积 | 123 MB |
| 内含 | `seekdb` 独立二进制、`libseekdb.so`、`libstdc++/libssl1.1/libcrypto1.1/libaio/libz` |
| 许可 | Apache-2.0 |
| 运行方式 | 独立进程，Unix socket + TCP 端口 |

### 2.2 路线 A 与路线 B

**路线 A（官方绑定）**：`seekdb.open(dir)` 拉起本地运行时并返回连接参数，SQL 通过 `mysql2` 走 socket。

实测：Node 24 与 Bun 1.3.14 均通过，`SELECT 1`、建表、向量检索全部正常。

**路线 B（Bun 原生 SQL 直连）**：直接运行 `native/seekdb --nodaemon --port N --base-dir D`，用 Bun 内置 `SQL` 连 MySQL 协议。

实测全部通过，且**不需要 Node.js，不需要 mysql2**：

```
mysql2 tcp:      OK
mysql2 socket:   OK
bun sql url:     OK   mysql://root@127.0.0.1:2882/test
bun sql opts:    OK   { adapter: "mysql", hostname, port, username }
```

**建议走路线 B。** 理由：去掉 Node 运行时依赖、去掉 mysql2 依赖、去掉原生 addon 在 Bun 下的加载风险，只剩一个独立二进制加 Bun 内置客户端。路线 A 保留作为回退。

### 2.3 事务语义（实测）

| 测试 | 结果 |
|---|---|
| 多表写入 + 中途抛异常 | 全部回滚：audit 0→0，edge_rows=0 |
| 跨数据库事务（mem_test + mem_shared） | 原子提交：local=1, shared=1 |
| 4 连接 × 50 并发写 | 200/200 成功，0 错误，239ms |

跨库原子性是实测结论，不是文档推断。这一点直接决定共享记忆不需要 outbox。

### 2.4 检索能力（实测）

| 查询 | seekdb p50 / p95 | SQLite 对照 p50 / p95 |
|---|---|---|
| 全文（MATCH AGAINST） | 1.56 / 4.52 ms | 0.04 / 0.18 ms (FTS5) |
| 向量（HNSW） | 1.06 / 5.40 ms | 1.23 / 2.22 ms（JS 暴力扫描） |
| 混合（向量+全文+标量） | 3.51 / 7.25 ms | 不原生支持，需应用层合并 |
| 纯标量过滤 | 0.29 / 4.67 ms | 0.01 / 0.09 ms |

数据集：1,000 条记忆，8 维向量，4 个项目。查询次数 20 次取分位。

写入吞吐：seekdb 1,000 行 227ms（0.23ms/行），SQLite 30ms（0.03ms/行）。

即时一致性：写入后立刻查询可见。

### 2.5 方言能力（实测）

| 能力 | 结果 |
|---|---|
| `ON DUPLICATE KEY UPDATE` | 通过 |
| `JSON_EXTRACT` + `JSON_UNQUOTE` | 通过 |
| 触发器 + `SIGNAL SQLSTATE` 约束 | 通过 |
| 递归 CTE 多跳遍历 | 通过（1→2→3→4，深度 3） |
| `FORK DATABASE` | **失败**：`fork database containing triggers not supported` |

### 2.6 资源与启动（实测）

| 指标 | 值 |
|---|---|
| 热启动到端口可用 | 3.5 s |
| 首次冷启动（全新目录） | **2.517 s**（两次独立实测一致），RSS 264 / 345 MB |
| 稳态 RSS | 264 至 345 MB |
| 线程数 | 80 |
| 子进程 | 0（单进程多线程） |
| 数据目录占用 | 2.2 GB（预分配 2G datafile + 2G log） |
| 1,000 行时 SQLite 对照 | 0.15 MB |
| 256M datafile 配置 | **启动失败**（errcode -4736，server_start 10/14），不要低于 1G |

### 2.7 Bun 特有的两个坑（实测，已复现并给出处理方式）

1. **`USE db` 的语义不稳定**。`sql.unsafe("USE mem_other")` 只影响当时那条池连接；后续查询可能仍指向 URL 里的库，也可能恰好复用同一连接而"看起来生效"。实测两种结果都出现过。**结论：适配层不得依赖 `USE`，一律全限定表名或按库建独立连接池。**
2. **类型映射与 `mysql2` 不同**。普通查询里 `DECIMAL` 返回**字符串**（`"12.34"`），`DATETIME` 返回 JS `Date`，`JSON` 返回对象，`BIGINT` 返回 number；但 `information_schema` 里的 `ROUND(...)` 返回 `Buffer`。适配层需要一个归一化函数，规则是"Buffer 或数字字符串转 number，Date 转 epoch ms"。

处理方式已在 `evals/seekdb/c4-bun-semantics.mjs` 中实现并验证（C4 PASS）。

### 2.8 未验证项（明确标记）

| 项 | 原因 | 验证方法 |
|---|---|---|
| x86_64 / macOS 二进制 | 本机仅 aarch64 | 在目标平台跑 `evals/seekdb/routeb.mjs` |
| 崩溃恢复与 redo 回放 | 未做 kill -9 实验 | 写入中断后重启，核对行数与 redo 日志 |
| 100 万级向量召回质量 | 数据量不足 | 用真实记忆语料跑 recall@10 |
| 长时间运行内存漂移 | 仅测稳态瞬时值 | 24h 写入+查询后复测 RSS |
| 备份与恢复 | 未测 | `cogmem snapshot` 对 seekdb 的等价路径 |

---

## 交付物 3: 目标架构

### 3.1 领域接口优先

不暴露 SQL 客户端，按业务语义切分。基于现有代码，建议六个端口：

```ts
interface RawLedgerPort {
  appendEvent(e: RawEvent): Promise<void>;
  appendBatch(es: RawEvent[]): Promise<void>;
  listBySeq(from: number, to?: number): Promise<RawEvent[]>;
}

interface EpisodePort {
  sealEpisode(e: Episode): Promise<void>;
  status(project: string): Promise<EpisodeStatus>;
  repair(plan: EpisodeRepairPlan): Promise<void>;
}

interface MemoryGraphPort {
  upsertBinding(b: MemoryBinding): Promise<void>;
  neighbors(node: string, hops: number): Promise<GraphNode[]>;
  path(from: string, to: string): Promise<GraphPath | null>;
}

interface RecallPort {
  candidates(q: RecallQuery): Promise<RecallCandidate[]>;
  explain(q: RecallQuery): Promise<RecallExplanation>;
}

interface GovernancePort {
  commitPlan(p: GovernancePlan): Promise<CommitResult>;   // 变更+关系+审计，单事务
  pendingCandidates(project: string): Promise<Candidate[]>;
}

interface SharedMemoryPort {
  publish(items: SharedItem[]): Promise<number>;          // 幂等
  retract(hash: string, by: string): Promise<void>;
  subscribe(collections: string[]): Promise<SharedItem[]>;
}
```

对应现有模块：`store/` → 各端口的适配器；`recall/` `retrieval/` → RecallPort；`governance/` → GovernancePort；`atlas/` → MemoryGraphPort。

### 3.2 避免过度抽象

三条约束：

1. **端口方法返回领域类型，不返回行对象**。转换只在适配器内部发生一次，不在调用链上反复映射。
2. **端口数量固定为六个**，新增能力先问是否属于已有端口，不新建。
3. **不引入 Repository + UnitOfWork + DAO 三层**。一个端口一个实现文件，事务边界由端口方法自己拥有，调用方不拼事务。

### 3.3 SQLite 适配器与双轨成本

先做 SQLite 适配器是对的：它是**行为基准**，能把"接口设计是否正确"和"seekdb 是否可用"两件事分开验证。

控制成本的办法：给 SQLite 适配器设退役条件，而不是让它长期存在。

- 阶段 1：端口接口 + SQLite 适配器，测试全绿，行为与 3.7.5 一致。
- 阶段 2：seekdb 适配器，跑同一套端口测试。
- 阶段 3：seekdb 通过全部端口测试后，SQLite 适配器降级为 `evals/` 下的对照实现，不进生产构建，不再接受新功能。

这样双轨期有明确终点，不是永久两套生产架构。

### 3.4 多宿主三方案对比

| 维度 | 方案 1：每宿主独立实例 + 共享实例 | 方案 2：单实例多库 | 方案 3：独立库 + outbox |
|---|---|---|---|
| 隔离边界 | 进程级，最强 | 逻辑级（库级权限） | 进程级 |
| 实例数 | 5 | 1 | 5 |
| 内存 | 5 × 293 MB ≈ 1.5 GB | 293 MB | 5 × 293 MB |
| 冷启动 | 5 次 | 1 次 | 5 次 |
| 跨宿主共享 | 跨实例，不原子，需 outbox | **单事务原子** | 不原子，需 outbox |
| 并发 | 天然隔离 | 4 连接实测 0 错误 | 天然隔离 |
| 错误隔离 | 强 | 中（一个库损坏不影响其他库） | 强 |
| 备份 | 逐实例 | 单实例多库导出 | 逐实例 |
| 撤回审计 | 需跨实例对账 | 单库内一致 | 需对账 |
| 安装复杂度 | 高 | 低 | 高 |

**建议方案 2**，但必须补一条隔离证明：seekdb 支持按库授权，需验证宿主 A 的连接在只有 `mem_a` 权限时无法读 `mem_b`。如果该验证不通过，退回方案 1。

理由：单实例把共享发布变成单事务（已实测跨库原子），省掉 outbox 和跨实例对账，是唯一能让"发布幂等 + 撤回可解释"简单成立的方案。

---

## 交付物 4: 原型与测量

代码位于 `evals/seekdb/`：

| 文件 | 作用 |
|---|---|
| `routeb.mjs` | 路线 B 主探针：建表、1,000 行写入、四类检索延迟、事务回滚、跨库事务 |
| `baseline-sqlite.mjs` | 同一工作负载的 SQLite 对照基线 |
| `probe3.mjs` | 方言能力、触发器约束、递归 CTE、FORK、4 连接并发写 |
| `coldstart.sh` | 全新数据目录的冷启动计时 |
| `warmstart.sh` | 已初始化目录的热启动计时与资源占用 |

复现命令：

```bash
cd evals/seekdb
N=../../node_modules/@oceanbase/seekdb-node-linux-arm64-gnu/native
LD_LIBRARY_PATH=$N $N/seekdb --nodaemon --port 2882 --base-dir ./sd --data-dir ./sd/store \
  --parameter datafile_size=2G --parameter log_disk_size=2G &
bun routeb.mjs
bun baseline-sqlite.mjs
bun probe3.mjs
bash warmstart.sh
```

原始结果见本文件 2.3 至 2.6 节，均为本机实际输出。

---

## 交付物 5: 采用建议

### 结论：有条件采用

**理由（按权重）**

1. **SQLite 的单写者约束是真实架构上限。** 四个宿主共享记忆，`CONCURRENT_ACCESS.md` 明确禁止两个写内核同时工作。seekdb 实测 4 连接 200 次写 0 错误，这是 SQLite 做不到的。
2. **跨库原子事务实测成立。** 共享记忆的"发布幂等 + 撤回可解释"因此可以是一个事务，不需要 outbox 和跨库对账。这是本次评估里最有价值的发现。
3. **向量与全文在同一个执行计划里。** 省掉 sqlite-vec 与 FTS5 的应用层合并，也省掉两套索引的维护。

**关闭条件（任一不满足则不采用）**

- C1 冷启动：已关闭。全新目录 2.517 s，热启动 3.5 s。唯一注意点是 `datafile_size` 不能低于 1G，256M 会启动失败。
- C2 设计不依赖 FORK/MERGE：实测含触发器的库无法 fork，而 Cogmem 有 57 个触发器。Dream 的"实验后合并"必须回到应用层暂存。
- C3 平台矩阵：x86_64 与 macOS 必须在发布前实测通过。
- C4 Bun SQL 语义：类型归一化（DECIMAL→number）与连接池事务绑定必须在适配层固化，并有测试。

**如果最后不采用，最主要的三个原因会是**

1. 资源开销：2.2 GB 预分配磁盘加 264 至 345 MB 常驻内存，对一个单用户本地记忆内核不成比例；SQLite 在 1,000 行时只占 0.15 MB。
2. 1,472 个同步调用点全量异步化，加上 50 个测试文件与 85 个同步事务回调，改造风险高于收益。
3. 亚毫秒级本地查询被拉长到 1 至 5 毫秒：全文 0.04→1.56 ms，标量 0.01→0.29 ms。绝对值可接受，但说明它是为并发与规模设计的引擎，不是为单机小数据设计的。

### 建议的执行顺序

不要先动 `src/`。按这个顺序：

1. 用 SQLite 现状跑一遍端口接口设计，确认六个端口能覆盖现有行为（不改实现，只加接口和适配器）。
2. 解 C1：测试不同 `datafile_size`（256M/512M）对冷启动的影响，找出可接受的预分配参数。
3. 解 C3：在 x86_64 上跑同一套探针。
4. 全部通过后，再按端口逐个迁移 store，每迁一个跑一次对照测试。

在 C1 关闭之前，不建议启动 store 层重写。
