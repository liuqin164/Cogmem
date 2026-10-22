# Cogmem 连续开发进度

> 唯一进度源。每轮开始读这里，每轮结束更新这里。
> 最后更新：2026-10-23 07:36 JST

## 当前状态

- 仓库：`~/projects/Cogmem`
- 分支：`main`
- HEAD：`c7362d1` docs: check every host section against its vendor reference（本地提交，未推送、未打 tag）
- 上一个：`46ba0a5`（docs: record tool execution）、`d50cec5`（fix: migration write lock）、`5ee3312`（feat: 4.0.0）
- 版本：`4.0.0`，`publishConfig.access=public`，23 个 bin
- 工作区：4 项未提交（`.gitignore`、`package.json`、`__tests__/release-metadata.unit.test.ts`、新文件 `scripts/build.mjs`），均为本轮构建安全改造
- 测试：`1525 pass / 0 fail / 1525 tests / 163 files / 5654 expect`（**全绿**，169.84s）
- 类型检查：干净
- dist：与 HEAD 逐字节一致（`git status dist` 0 项），1315 文件（含 `.tsbuildinfo`，未跟踪）
- 发布门禁：pack 898 文件 / 910.6 kB / 4.2 MB unpacked，`verify:packed-migration` 通过，`npm publish --dry-run` exit 0
- npm 登录：**未登录**（`npm whoami` → need auth），publish 需要用户 `npm login`
- 常驻服务：无（MCP 服务按需启动；但发现一个 45 分钟未退出的测试子进程，见下轮任务）

## 一条基线失败已清零（2026-10-23 06:10）

`init supports non-interactive dry-run config generation` 已修，**没有改断言为 2560**。

根因不是产品缺陷，是测试不可复现：`cogmem init` 无条件探测 `localhost:11434`，
本机装了 `qwen3-embedding-4b:latest`（实测 `/api/tags` 返回 2560 维），
于是 `--agent none --dry-run` 生成的 `vector_dimension` 取决于**跑测试的机器装了什么模型**。
CI 上没 Ollama 就绿，本机就红。

修法取「让测试不依赖本机 Ollama」这条（进度文件里列的第 1 条），而不是把断言改宽：

- `src/bin/init.ts` 新增 `--no-probe`：`readArgs` 里 `probeOllama: !argv.includes('--no-probe')`，
  `detectBackends(probeOllama = true)` 跳过 `fetch`，`AbortController`/`setTimeout` 移进该分支内
  （不再对不需要的探测挂定时器）。
- `printDetection(det, probed = true)`：跳过探测时打印 `Ollama    – skipped (--no-probe)`，
  不谎称 "not running"。
- 测试改为带 `--no-probe`，断言仍是 `vector_dimension = 384`（`DEFAULT_VECTOR_DIMENSION`），
  现在锁的是「探测不到 → 回落 384」这条真实分支。
- 新增测试 `init --no-probe skips the Ollama probe so dry-run output is machine-independent`，
  同时锁 `--vector-dimension` 仍优先于（被跳过的）探测。
- README 补 `--no-probe` 用法（原文没记录 init 任何 flag），CHANGELOG 4.0.0 补一条。

实测对照（同一命令，只差一个 flag）：

| 命令 | Ollama 行 | vector_dimension |
|---|---|---|
| `bun src/bin/init.ts --yes --dry-run --agent none` | `✓ running — 2 model(s)` | `2560` |
| 同上 `+ --no-probe` | `– skipped (--no-probe)` | `384` |
| `+ --no-probe --vector-dimension 384`（README 那条） | `– skipped (--no-probe)` | `384` |

**非空断言已验证**：临时把 `probeOllama: !argv.includes('--no-probe')` 改回 `probeOllama: true`，
新测试即失败（`Expected to contain: "Ollama    – skipped (--no-probe)"`，实际收到
`✓ running — 2 model(s): qwen2.5:7b, qwen3-embedding-4b:latest` 且 `vector_dimension = 2560`），
恢复后通过。

## 已完成（未提交）

- 六个领域端口 `src/ports/index.ts` + SQLite 适配器 `src/adapters/sqlite/`
- 共享区 `SqliteSharedMemory`：幂等发布、软撤回、发布方专属
- MCP Streamable HTTP 传输 `src/mcp/http.ts`，一进程一 kernel、一会话一 transport
- 三档工具面 `src/mcp/profiles.ts`：core 8 / admin 21 / full 37
- `--project` 连接绑定 + `project_scope_violation`
- 四个共享工具：publish / retract / subscribe / explain
- 配置模式下共享工具可用（`attachSharedFromKernel`）
- 版本 4.0.0 元数据、CHANGELOG、RELEASE_CHECKLIST、README、docs/mcp-hosts.md
- 打包安装验证通过：`packed 4.0.0 types, schema31 -> 0032, schema32 runtime, OpenClaw 0.7.2, and MCP verified`

## 下一项任务（按优先级）

### P4 — 发布前收尾（剩余＝需要用户授权）

原 3 项已完成（2026-10-23 07:36 在当前 HEAD `c7362d1` 上复跑）：

1. ✅ pack 清单：898 文件 / 910.6 kB / 4.2 MB unpacked；`dist/bin/mcp.js`、`dist/bin/init.js`、
   `dist/ports/index.js`、`docs/mcp-hosts.md`、`install.sh` 齐全；**无** `__tests__`、`evals`、`.bak-*`。
   `src/` 本来就不发包（`files` 只列 `dist/**/*.js` 与 `.d.ts`，设计如此）。
2. ✅ `bun run verify:packed-migration` → `packed 4.0.0 types, schema31 -> 0032, schema32 runtime, OpenClaw 0.7.2, and MCP verified`
3. ✅ 发布摘要不再需要单独文档：CHANGELOG 4.0.0 已覆盖，`npm publish --dry-run` exit 0，
   阻塞点只剩 **npm 未登录**（`npm whoami` → `need auth`）

**需要用户决定（三条，agent 不能代做）**：
- `npm login`（本机未登录，publish 与带鉴权的 dry-run 都卡在这）
- tag `v4.0.0` + GitHub Release
- `npm publish`（`prepublishOnly` 会自动跑 typecheck + 全量测试 + build + pack + verify，约 4 分钟）

**待落提交**：本轮 4 项改动（`.gitignore`、`package.json`、`scripts/build.mjs`、`release-metadata` 测试）
＋ `RELEASE_CHECKLIST.md` 说明。按 cron 规则不自行 commit。

### P6 — 测试是否泄漏 MCP 子进程（下一条自主任务）

2026-10-23 07:23 观察到：`bun src/bin/mcp.ts --transport http --port 7351 --bind 127.0.0.1
--db /tmp/dbg-deep/x/y/memory.db --profile core` 已存活 45 分钟未退出，路径正是
P2d 的 `--db path handling` 测试用的 `<scratch>/deep/...` 形态，高度怀疑
`__tests__/mcp-execution.unit.test.ts` spawn 子进程后没在结束时 kill。

范围：只在测试侧查（不要改产品行为），确认泄漏点 → 加 `afterAll`/`try/finally` kill →
非空验证（跑完该测试后 `ss -ltnp | grep <port>` 无残留）。注意 `pkill -f` 会匹配执行它的 shell，用精确 PID。

### P5 — OpenClaw 真实工具执行（需要窗口）

只能给运行中的 gateway 发消息触发，会干扰正在工作的 agent。等用户安排独占窗口。

### P2d — 已完成（2026-10-23 06:58）：`--db` 父目录自动创建

修复点选在 `createMemoryKernel`（`src/factory.ts`），不在 MCP 入口：所有 CLI
（snapshot / strategy / episode / prospective / memory / import-support）都经过它，
一处修全部受益。新增 `ensureDatabaseDirectory`，跳过 `:memory:` 与 `file:` URI。

- 复现测试：`__tests__/mcp-execution.unit.test.ts` 的「--db path handling」，用
  `<scratch>/deep/nested/dirs/memory.db`，断言目录被建出来、`tools/list` 返回 8
- **非空已验证**：临时注释掉 `ensureDatabaseDirectory(options.dbPath)` 后该测试 3.3ms 内失败，恢复后通过
- 真实 CLI 验证：`bun run build` 后 `bun dist/bin/mcp.js --transport http --db /tmp/dbg-final/a/b/c/memory.db`
  正常监听，`initialize` 返回 200（修复前是 `unable to open database file` 退码 1）
- 文档三处同步：`docs/mcp-hosts.md` 的 stdio 段、systemd 示例注释、故障排查表
- 测试：`bun test __tests__/mcp-execution.unit.test.ts` **10 pass / 0 fail**；
  `bun run typecheck` exit 0；全量 **1521 pass / 0 fail / 163 files**

### P2d 原始任务描述（保留）

### P2d — `--db` 父目录不存在时服务直接失败（原始记录）

P2b 期间发现：`bun dist/bin/mcp.js --db /nonexistent/dir/memory.db` 直接抛
`unable to open database file`，服务**不建目录**。当时的处置只是在 `docs/mcp-hosts.md`
补了一句"先跑 `cogmem init`"，产品行为没改。

这条是真实可用性缺陷：任何 `--db` 指向尚未存在的目录（新机器、新项目、容器首启）
都会失败，而 SQLite 本身只需要父目录存在。修法明确且可验证：

1. 先写复现测试：`--db <tmp>/a/b/c/memory.db` 断言服务能起监听（现在是退码 1）。
2. 在打开数据库之前 `mkdirSync(dirname(dbPath), { recursive: true })`，
   位置选在 kernel 建立之前、路径解析之后；注意 `:memory:` 与 `file:` URI 要跳过。
3. 修完回来把 `docs/mcp-hosts.md` 里"必须先 `cogmem init`"的措辞改准确
   （`init` 仍需要，但不再是 `--db` 的前置条件）。

验证标准：上面那条命令 exit 0 且 `tools/list` 返回 8；`docs/mcp-hosts.md`
的 236-237 行与 312 行三处措辞同步；全量测试不回落。

### P2b — 已完成（2026-10-23 04:15）

stdio 与 systemd 两节已实测修正，并在过程中发现一个真实产品缺陷（见下）。

### 已完成 P2b，并修掉一个真实缺陷：过期 dist 让 HTTP 起不来

`dist/bin/mcp.js` 是 00:20 的构建产物，`src/bin/mcp.ts` 在 01:02 之后改过，
dist 里多了一段 src 根本没有的代码：

```js
shared: args.dbPath ? new SqliteSharedMemory(new Database(resolve(args.dbPath))) : undefined,
```

这行在 kernel 建立**之前**就裸开 `Database` 并建 `shared_items` 表。空库因此变成
"有用户表但没有 `_schema_migrations`"，`assertSupportedReleaseSchema` 判定为
`unsupported_database_identity`，HTTP 传输启动即崩（退码 1）。stdio 不走
`shared` 那条路，所以 stdio 一直是好的，缺陷被掩盖。

实测对照（同一命令，只换入口）：

| 入口 | 结果 |
|---|---|
| `bun run dist/bin/mcp.js --transport http --db <空库>` | `unsupported_database_identity`，退码 1，无监听 |
| `bun run src/bin/mcp.ts --transport http --db <空库>` | `listening on http://127.0.0.1:7394/mcp`，153 表 |

修法：`bun run build` 重建 dist（先 `tar czf` 备份到 scratch）。重建后
`dist` 相对 HEAD 有 20 项变化，`dist/bin/mcp.js` 里那行消失，HTTP 在新库上
正常起监听、`tools/list` 返回 8。

### P2b 实跑记录（全部真跑）

**stdio 章节**

- `command -v cogmem-mcp` → 未找到。`cogmem-mcp` 是 `package.json` 的 `bin` 条目，
  只有全局安装后才在 PATH 上。本机没装，`~/.npm-global/bin` 里也没有 cogmem。
- 临时 prefix 装包验证：`npm pack` → 906634 字节 898 文件 →
  `npm install -g --prefix scratch/p2b/prefix` 成功，`prefix/bin/cogmem-mcp` 出现。
  用它跑 stdio：`initialize` 与 `tools/list` 都回正确 JSON-RPC（逐行 JSON，非 SSE）。
- 仓库内无包装：`printf '<initialize><tools/list>' | bun run dist/bin/mcp.js --db X --profile core`
  同样通。
- 新发现：`--db` 的父目录不存在时直接 `unable to open database file`，服务不建目录。
  文档原来给的 `/home/you/.cogmem/memory.db` 在 `cogmem init` 之前跑必然失败。

**systemd 章节**（四个变体，逐个装 unit 实跑后清理）

| ExecStart | systemctl 结果 |
|---|---|
| `%h/.local/bin/cogmem mcp ...` | `Result=exit-code` `ExecMainStatus=203`（EXEC） |
| `cogmem mcp ...`（裸命令） | `203/EXEC`，`ActiveState=failed` |
| npm 装的 `cogmem` 包装器绝对路径 | `active (running)`，监听成立 |
| `/usr/local/bin/bun <abs>/dist/bin/mcp.js ...` | `active (running)`，`tools/list` 返回 8 |

裸命令失败的原因查到根：`systemctl --user show-environment` 的 PATH 是
`/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games:/usr/local/games:/snap/bin`，
不含 `~/.npm-global/bin` 也不含 `~/.local/bin`。`npm config get prefix` 本机是
`/home/ubuntu/.npm-global`，不是文档写的 `~/.local/bin`。

另外确认：即便 `ExecStart` 写对了，`--db %h/.cogmem/memory.db` 在 `~/.cogmem`
不存在时仍以 `unable to open database file` 退码 1（`NRestarts=0`）。文档已补
`cogmem init` 前置步骤。

所有测试 unit（a/b/c/d/e）已 stop、disable、删文件、`daemon-reload`；
`systemctl --user list-unit-files 'cogmem*'` 现为 0 项，测试端口全部释放。

### P0 — 工具面一致性审计（已完成 2026-10-23 01:55）

37 个工具逐个发最小调用，26 ok / 11 可达 / **0 缺陷**。脚本在 `evals/mcp/tool-audit.ts`，
用 `bun evals/mcp/tool-audit.ts` 跑，可 `--json`。**无**"能列出不能执行"的工具。

### P1 — 真实工具执行验证（已完成 2026-10-23 01:58）

`__tests__/mcp-execution.unit.test.ts` 6 个测试覆盖：写入后召回命中原文、跨会话共享可见、
撤回后订阅不可见但 explain 仍可查、未知工具报错、缺参数报字段名、空项目召回不抛错。

### P2c — 已完成（2026-10-23 06:10）

`init` 的环境依赖已解耦，测试断言未放宽。下一项见文末。

### P2c 原始描述（留档）

只剩 `init supports non-interactive dry-run config generation` 一条失败，是环境依赖不是产品缺陷：
`src/bin/init.ts` 读本机 Ollama 得 `vector_dimension = 2560`，测试断言 384。

两条正确修法（都要真跑验证，不得直接改断言为 2560）：
1. 让测试不依赖本机 Ollama：`--agent none` 时如果没显式指定模型，维度应走默认常量而非探测；
   `init` 加 `--no-probe` 或测试里注入一个假的 Ollama 端点。
2. 把"模型名 → 维度"的推导抽成纯函数并单测（同名测试 `init recognizes Qwen3 embedding GGUF model names`
   已在测这块），断言只锁"探测不到时回落 384"这条分支。

先读 `src/bin/init.ts` 的探测与回落逻辑再决定改哪边。

### P1 — 宿主真实调用（2026-10-23 07:25 更新：3/5 完成）

| 宿主 | 连接 | 枚举 | 真实执行 | 配置还原 |
|---|---|---|---|---|
| Hermes v0.22.2 | ✅ | ✅ 23 | ✅ remember+recall，DB 确认 | diff 0 行 |
| OpenClaw 2026.10.5 | ✅ | ✅ 23 | ✅ remember+recall，DB 确认 | diff 0 行 |
| codex-cli 0.163.0 | ✅ | ✅ 23 | ✅ remember+recall，DB 确认 | 已 remove |
| Claude Code | ❌ 未装 | - | - | - |
| Cursor | ❌ 未装 | - | - | - |

- Codex 真机：`codex mcp add` → `codex mcp list`（enabled）→ `codex exec` 触发
  `mcp: cogmem/cogmem_remember_turn (completed)`，库中 `evt-3916a69c-...` 与 neuron 投影均在背
- Codex 两个坑：0.163 只接受 `wire_api = "responses"`（chat 直接被拒）；`codex exec`
  默认 sandbox 挡住 loopback 连接，测试用了 `--dangerously-bypass-approvals-and-sandbox`
- OpenClaw 真机：`openclaw agent --local` 在有 gateway 时拒绝启动；改用
  `openclaw agent -m ... --session-key exec-test-1`（不投递）跑通，`evt-946ce6be-...` 入库
- Claude Code / Cursor：本机无 Anthropic key、无 Cursor 账号，Cursor 还是桌面客户端，**未测，不标通过**

- Hermes v0.22.2：**已通过真实工具执行**（2026-10-23 02:10）
  `hermes -m magpie/auto/deepseek-v4.1-flash -z "<prompt>"` 让 Hermes 主动调用
  `cogmem_remember_turn` 和 `cogmem_recall`，返回值 `evt-c6859978-4563-4bd3-b34f-847a1b299537`。
  独立查库确认：`memory_events.event_id` 与之一致，`payload_json` 含标记文本，
  并扩散到 `neurons.content`、`neurons_fts`、`memory_episodes.summary`、`project_branches.title`、
  `topology_membership.title`、`interaction_units.semantic_text`、`cognitive_nodes.title`。
  测试后配置已还原（diff 0 行），服务已停。
- OpenClaw 2026.10.5：已验证连接 + 37 工具枚举；**未验证工具执行**。
  它没有 `mcp call` 类命令，触发执行只能给运行中的 gateway 发消息，会干扰正在工作的 agent，
  不做。要验就得安排一个独占窗口。
- Claude Code / Cursor / Codex：未安装，未测试，文档标注为"按官方格式编写"

宿主测试前必须备份配置，测完还原。参考：`openclaw.json.bak-hosttest-*`、`config.yaml.bak-hosttest-*`。

### P2 — 文档与行为一致性

`docs/mcp-hosts.md` 的每条命令都应该是跑过的。发现不一致就改文档并补测试。

- 2026-10-23 02:24 已修：文档写 `full` 33 / `admin` 21，实际注册表 37 / 23；
  `mcp-hosts.md` 自身还自相矛盾（正文 33、表格 37）、故障表写 `sees 6 tools`（core 实为 8）。
  已全部对齐到 `filterToolsByProfile` 的真实计数，并加断言测试锁死，防再漂。
- 2026-10-23 02:52 已完成逐条实测。**P2 文档完成度随本轮结束，只剩未装客户端的厂商章节**
  （Claude Code / Cursor / Codex 无本机客户端，配置格式未实测，文档里已声明）。

### P2 — 未实测项（缺客户端，不阻塞）

本机没有 `claude`、`cursor`、`codex` 三个 CLI，其章节只能按厂商文档格式写，不能宣称跑过。
验过的替代路径：Hermes 与 OpenClaw 的真实 `mcp add` / `probe` / `test` / `remove|unset` 全流程。

### P3 — seekdb 适配器（受阻）

C3 平台矩阵未验证（x86_64 / macOS）。本机是 aarch64，无法闭环。不要假装通过。

## 已知风险

- 工作区 43 项未提交，任何 `git checkout` / `reset` 都会毁掉 4.0 的全部工作
- `pkill -f` 会匹配到执行它的 shell，收尾时用精确 PID
- OpenClaw 与 hermes-gateway 同 cgroup，重启 openclaw.service 会杀掉 Hermes
- 本机无 `~/.cogmem/config.json`，配置模式只能用 `--config` 指定

## 恢复命令

```bash
cd ~/projects/Cogmem
git status --short
bun run typecheck
bun test __tests__/mcp-http.unit.test.ts
bun test __tests__
```

## 本轮记录

- 2026-10-23 07:40 — **五家官方文档对照完成**。逐条核对 Claude Code / Cursor / Codex / Hermes / OpenClaw 的官方 MCP 文档，改掉两处不准确：
  ① Claude Code 的 `.mcp.json` 里 `type` 不是可选：只写 `url` 不写 `type` 会被当成 stdio 直接跳过，报 `has a "url" but no "type"`；补上正确 JSON 与 `${VAR}` / `${VAR:-default}` 语法，以及 `--transport http` 的 SSE 回退要 v2.1.265+
  ② Codex 参考链接原指向 GitHub `docs/config.md`，该文件已只剩 726 字节的存根，改指 `developers.openai.com/codex/mcp`；顺带补 `default_tools_approval_mode`（auto/prompt/writes/approve），解决交互式下每次调用都要批准的问题
  Cursor 的 `mcpServers` + `url` + `headers` 与 `${env:NAME}` 插值经核对与官方一致，未改；补了一句 `envFile` 仅限 stdio。文末新增「Official documentation」表，五个宿主 + MCP 规范链接，未测的两个标注为"对照文档、非实测"。新增 1 个守卫测试锁住五条链接与 `type` 要求。全量 **1524 pass / 0 fail / 163 files**
- 2026-10-23 07:36 — **P4 发布门禁在当前 HEAD 复跑 + 修掉门禁自身毁 dist 的缺陷**（cron 轮；07:23 接手时锁的最后写入是 06:34，已过期 2473s）
  ① 门禁真实输出：`npm pack --dry-run --json` → **898 文件 / 910.6 kB / 4.2 MB unpacked**，`__tests__`/`evals`/`.bak-*` **0 命中**，`dist/bin/mcp.js`、`dist/bin/init.js`、`dist/ports/index.js`、`docs/mcp-hosts.md`、`install.sh` 全在包内（`src/` 不发包是 `files` 的设计）；
  `verify:packed-migration` → `packed 4.0.0 types, schema31 -> 0032, schema32 runtime, OpenClaw 0.7.2, and MCP verified`；
  `npm publish --dry-run --access public --ignore-scripts` → exit 0、898 文件，唯一告警是未登录。元数据机械核对 9 项全 PASS（`publishConfig.access=public`、`exports .` → `dist/public.js`、23 bin、无 `.db`/`.sqlite`/`.DS_Store`/`.tsbuildinfo` 被跟踪）
  ② **撞上的真缺陷**：`npm publish --dry-run` 会先跑 `prepublishOnly`，而 `build` 是 `rmSync('dist') && tsc -p`。180s 超时杀掉进程后 dist 已删、tsc 未跑完 → 工作区出现 **1314 个已跟踪 dist 文件被删**（只剩 `dist/.tsbuildinfo`）。不是网络（`npm ping` PONG 164ms），是门禁自身的破坏性前置删除
  ③ 修法：新增 `scripts/build.mjs`，先编译到 `dist.next`（`--outDir`/`--tsBuildInfoFile` 覆盖），**只有 `tsc.status === 0` 才** `rmSync('dist')` + `renameSync('dist.next','dist')`；失败分支清暂存后退出。`package.json` 的 `build`/`prepare` 都指向它，`.gitignore` 加 `dist.next/`
  ④ **非空已验证**：注入 `src/__build_failure_probe.ts`（`const probe: number = 'not a number'`）后 `bun run build` → `error TS2322` + `build failed; the previous dist/ was left untouched`，**exit 2**，dist 前后均 1315 文件、`git status dist` **0 项**、`dist.next` 已清；删探针后重建 exit 0、dist 仍 0 项差异。新增守卫测试 `the build swaps dist in only after tsc succeeds`，**非空已验证**：把 `scripts.build` 改回旧形式后该测试 `1 fail`，还原后通过
  ⑤ 真实数字：`bun run build` 16.2s（与旧的整删重建同耗时）；`bun run typecheck` exit 0；`bun test __tests__/release-metadata.unit.test.ts` **15 pass / 0 fail / 160 expect**；全量 **1525 pass / 0 fail / 163 files / 5654 expect / 169.84s**
  ⑥ 文档：`RELEASE_CHECKLIST.md` 补两条——`npm publish --dry-run` 会连带跑 `prepublishOnly`（约 4 分钟，只查打包用 `--ignore-scripts`）；`build` 已改为暂存+交换，旧的先删 dist 在编译被打断时会删掉 1314 个文件
  ⑦ **并发告警**：接手后另一会话仍在同一 worktree 工作（07:20:12 提交 `c7362d1`，07:33 后继续改 `src/host/openclaw/AutoMemoryPluginInstaller.ts` 与 `__tests__/memory-atlas-openclaw.unit.test.ts`）。**锁协议失效：它从不刷新 `docs/overnight.lock`**。我因此只做读操作与门禁，未在对方改 src 后再跑构建（避免把半成品烘进已跟踪的 dist）
- 2026-10-23 06:55 — **多写者实测，修掉一个启动崩溃**。探针 `evals/concurrency/writer.ts`（4 进程 × 20 turn，`immediate_compile`）：
  ① 空库 4 个并发启动，修前 3 个死在 schema migration（`table already exists`），只有 1 个活下来；修后 4 个全起、schema 只应用一次、`integrity_check` ok。
     修法：`SchemaMigrationRunner.run()` 在事务内重读 `plan()`（`remaining`），并用 `transaction.immediate()` 一开始就拿写锁。
  ② 已初始化库 4 个并发写：80 条里 12 条 `database is locked`（busy_timeout 5000ms），无重复、无损坏；失败调用可能已提交 raw event，宿主盲目重试会产生第二条 turn。
  实测结论写进 `CONCURRENT_ACCESS.md` 新增的「Measured behaviour」一节，明确四进程是对抗性负载、单 HTTP 服务仍是多宿主唯一支持形态。
  新增 2 个测试（stale plan 重读、双连接只应用一次），**非空已验证**：把 `remaining` 改回 `pending` 后 stale plan 测试立即失败。
  测试：`bun test __tests__/schema-migration.unit.test.ts` 5 pass；全量 **1523 pass / 0 fail / 163 files**
- 2026-10-23 06:50 — **发布前收尾完成并落本地提交** `5ee3312`（74 文件，+5106/−90）：`npm pack` 898 文件无 tests/evals/bak，关键文件齐全；`verify:packed-migration` 输出 `packed 4.0.0 ... and MCP verified`；敏感模式扫描只命中测试 canary。未推送、未打 tag、未 publish
- 2026-10-23 06:58 — **P2d 完成**：`--db` 父目录不存在时自动创建（`createMemoryKernel` 里加 `ensureDatabaseDirectory`，跳过 `:memory:`/`file:`）。复现测试非空已验证（注释掉修复后 3.3ms 失败）；dist 重建后真实 CLI 用 `/tmp/dbg-final/a/b/c/memory.db` 起监听、`initialize` 200。文档三处同步。全量 1521 pass / 0 fail
- 2026-10-23 06:10 — **P2c 完成，基线失败清零**（`1520 pass / 0 fail`）。原失败 `init supports non-interactive dry-run config generation` 不是产品缺陷而是测试不可复现：`cogmem init` 无条件 `fetch('http://localhost:11434/api/tags')`，本机装了 `qwen3-embedding-4b:latest`（`curl /api/tags` 实测两个模型 `qwen2.5:7b`、`qwen3-embedding-4b:latest`），`inferEmbeddingVectorDimension` 对 4b 返回 2560，于是 `--agent none --dry-run` 的输出取决于跑测试的机器装了什么模型。**没有把断言改成 2560**，而是实现 `--no-probe`：`InitArgs` 加 `probeOllama`，`readArgs` 里 `probeOllama: !argv.includes('--no-probe')`，`detectBackends(probeOllama = true)` 跳过 fetch 并把 `AbortController`/`setTimeout` 移进探测分支（避免为不跑的探测挂 2.5s 定时器），`printDetection(det, probed = true)` 在跳过时打印 `Ollama    – skipped (--no-probe)` 而非谎称 not running。测试加 `--no-probe`，断言仍是 384（`DEFAULT_VECTOR_DIMENSION`），现在锁的是"探测不到→回落 384"这条真实分支
- 2026-10-23 06:10 — 实测对照（同一命令只差一个 flag）：无 flag → `✓ running — 2 model(s): qwen2.5:7b, qwen3-embedding-4b:latest` + `vector_dimension = 2560`；`--no-probe` → `– skipped (--no-probe)` + `vector_dimension = 384` + `provider = "deterministic_local"`；`--no-probe --vector-dimension 384` → 384。三种都 exit 0、stderr 空
- 2026-10-23 06:10 — 新增测试 `init --no-probe skips the Ollama probe so dry-run output is machine-independent`（同时锁 `--vector-dimension` 仍优先于被跳过的探测）。**非空断言已验证**：临时把 `probeOllama: !argv.includes('--no-probe')` 改回 `probeOllama: true`，该测试失败（`Expected to contain: "Ollama    – skipped (--no-probe)"`，收到 `✓ running — 2 model(s)` 与 `vector_dimension = 2560`），恢复后通过
- 2026-10-23 06:10 — 文档：README 在「向量维度对照表」后补 `--no-probe` 用法与"本机装 4b 就会写 2560 而非默认 384"的说明（原文没记录 init 的任何 flag），并**实测 README 里那条命令**跑通（`bun dist/bin/init.js --yes --dry-run --agent none --no-probe --vector-dimension 384` → `vector_dimension = 384`）；CHANGELOG 4.0.0 补一条
- 2026-10-23 06:10 — `dist` 重建：`bun run build`（先 `tar czf` 备份到 scratch `dist-pre-noprobe-*.tgz`），`src/bin/init.ts` 与 `dist/bin/init.js` 各含 2 处 `no-probe`（flag 判定 + 提示文案）。重建后 `dist/bin/init.js` 实跑 `--no-probe` 正常。`package.json` 的 `cogmem-init` bin 指向 `dist/bin/init.js`，不重建会漏这个 flag
- 2026-10-23 06:10 — 测试真实结果：`bun test __tests__/core-cli.unit.test.ts` **30 pass / 0 fail / 190 expect**（原 28 pass / 1 fail）；`bun run typecheck` exit 0；全量 `bun test __tests__` **1520 pass / 0 fail / 1520 tests / 163 files / 5628 expect / 162.35s**（从 1518/1 到全绿，基线两条失败均已清零）

- 2026-10-23 05:25 — **修掉基线性能失败**（outbox 分页 14.2s 超 10s）。定位不是算法而是缺 PRAGMA：`PolicyExecutionStore` 与 `PlanRuntimeStore` 的 `initializeSchema` 只设 `busy_timeout`，没设 `journal_mode`/`synchronous`，于是沿用 SQLite 默认 `journal_mode=delete` + `synchronous=FULL`，每条 autocommit 语句一次 fsync。实测：`bun:sqlite` 新建库 `PRAGMA synchronous=2`、`journal_mode=delete`，100 条 autocommit insert 638ms，同一批放进一个事务 8ms，改 WAL 后 230ms。分相位探针显示 250 次 policy upsert 5034ms、两次构造器 flush 各约 4.5s。加 `PRAGMA journal_mode=WAL` + `PRAGMA synchronous=NORMAL`（与 `src/core/MemoryGraph.ts:81-82` 同一文件同一做法一致）后：同一条测试 **13.83s → 3.19s 通过**，分相位 5034ms→108ms、4663ms→1472ms、4474ms→1496ms。剩余 1.4s 来自 `EventStore.append` 每条一个事务走它自己的 FULL 同步连接，属持久性策略，未擅自改
- 2026-10-23 05:25 — 新增守卫测试 `policy and runtime stores open in WAL so outbox drains do not fsync per statement`，断言落盘 `journal_mode=wal`。**已验证非空断言**：临时删掉两处 PRAGMA 后该测试失败（`Expected - 1 / Received + 1`），恢复后通过。过程中发现并纠正自己的一个错误断言：`synchronous` 是每连接属性、不落库，重开连接恒为 2，所以该断言测的是错的东西，已删掉并在注释说明；改用测试本身的 drain 预算覆盖 `synchronous=NORMAL`
- 2026-10-23 05:25 — `dist` 重建：`bun run build`（先 `tar czf` 备份到 scratch `dist-pre-wal-*.tgz`），`dist/store/PolicyExecutionStore.js` 与 `dist/store/PlanRuntimeStore.js` 各含 1 处 `journal_mode=WAL`。未重建前这两个文件 0 处，即上一轮"过期 dist"那类缺陷会立刻复发
- 2026-10-23 05:25 — 测试真实结果：`bun test __tests__/projector-reliability.unit.test.ts` **13 pass / 0 fail / 45 expect**；`bun test __tests__/projector-reliability.unit.test.ts __tests__/policy-execution-isolation.unit.test.ts __tests__/governance-security.unit.test.ts` **42 pass / 0 fail / 228 expect**；`bun run typecheck` exit 0；全量 `bun test __tests__` **1518 pass / 1 fail / 1519 tests / 163 files / 5618 expect**（从 1516/2 改善；唯一 fail 是 `init dry-run`，实测本机 Ollama `qwen3-embedding-4b:latest` 返回 2560 维，测试断言 384，**未改该断言**）
- 2026-10-23 01:20 — 建立本文件；修复配置模式共享工具缺陷（`attachSharedFromKernel`），新增 1 个测试；全量 1501 pass / 2 fail
- 2026-10-23 01:55 — 工具面审计 `evals/mcp/tool-audit.ts`：37 个工具逐个发最小调用，26 ok / 11 可达（业务前置条件错误）/ **0 缺陷**，无"能列出不能执行"的工具
- 2026-10-23 01:58 — 真实执行测试 `__tests__/mcp-execution.unit.test.ts`（6 个）：写入后召回命中原文、跨会话共享可见、撤回后订阅不可见但 explain 仍可查、未知工具报错、缺参数报字段名、空项目召回不抛错
- 2026-10-23 02:05 — HTTP 资源安全：会话数上限（默认 32，超限关最旧）、`stop()` 关闭自建 kernel（WAL 落盘）。新增 2 个测试，总 1509 pass / 2 fail / 163 files
- 2026-10-23 02:10 — **Hermes 宿主真实执行打通**：`hermes -z` 经 MCP 调 `cogmem_remember_turn` + `cogmem_recall`，返回 `evt-c6859978-...`，独立查库确认 event_id 一致且标记文本扩散到 7 张表。测试后配置还原（diff 0 行）、服务已停
- 2026-10-23 02:25 — 项目隔离测试 2 个：跨项目写入后用 canary 召回，`items` 为空、候选数全 0；绑定连接即使 query 里点名另一项目也读不到。总 1512 pass / 2 fail / 163 files
- 2026-10-23 02:24 — P2 文档漂移修复：工具面计数三处不一致（`mcp-hosts.md` 正文 33 vs 表格 37、`admin` 21 vs 实际 23、故障表 `sees 6 tools` vs core 8），README 与 CHANGELOG 同步 21→23。新增 1 个断言测试直接读 `filterToolsByProfile` 与三份文档比对。`bun test __tests__/release-metadata.unit.test.ts` 10 pass / 0 fail；`bun run typecheck` exit 0；全量 `bun test __tests__` 1512 pass / 2 fail / 1514 tests / 163 files（2 fail 仍是原两条基线）
- 2026-10-23 02:33 — 持久性测试：发布 + 撤回后重启服务，未撤回条目仍在订阅里，撤回条目仍 explain 得到 `retracted=true`。总 1513 pass / 2 fail / 163 files
- 2026-10-23 02:52 — **P2 文档逐条实测完成**，发现并修掉 4 处与实际 CLI 行为不符的文档：
  ① `openclaw mcp probe` 计数说"37 意味着 full"，实际 core 服务探测报 8，改为"8 = core，37 = full"；
  ② 文档断言"没有 `openclaw mcp remove`，只能手改 json"，**错**——`openclaw mcp unset <name>` 存在且可用（实测 `Removed MCP server "cogmem"`），`remove` 才是不存在的那条；写出正确卸载路径与 `reload`；
  ③ 文档断言 `hermes mcp add` "piping the answers in does not work"，**错**——`printf 'n\nY\n' | hermes mcp add ...` 实测保存成功（`Saved 'cogmem' to ~/.hermes/config.yaml (8/8 tools enabled)`）；真正会失败的是 stdin 为空时 getpass 回退读空 token、enable 提示吃 EOF 而取消；
  ④ 故障排查表把端口占用写成 `EADDRINUSE`，真实输出是 `Failed to start server. Is port 7337 in use?`；`session_not_found` 实为 HTTP 404；补 `Server not initialized`(400) 这条最常见的坑。
  另补上原文档缺失的关键一步：裸 `initialize` curl 之后**必须回放 `mcp-session-id`**，否则后续调用全部 400，原文只给了一条 curl 就结束，照着做必然卡住。
- 2026-10-23 02:52 — 实测记录（全部真跑，非推断）：裸 curl 拿到 `serverInfo: cogmem-local/4.0.0`；带 SID 调 `tools/list` 得 **core 8 / admin 23 / full 37**（三个 profile 各起一个进程实测）；`--token` 无头返回 **401 + body `unauthorized`**，带头 200；core 上调 admin 工具返回 `tool_not_in_profile: cogmem_shared_publish ...`；伪造 session 返回 **404 `session_not_found`**；`--project` 绑定后跨项目调用返回 `project_scope_violation`；端口占用返回 `Failed to start server. Is port 7337 in use?`
- 2026-10-23 02:52 — 宿主真实流程：`openclaw mcp add` → `probe` (8 tools) → 不加 `--transport` 复现 `SSE error: Non-200 status code (400)`（文档这条描述准确）→ `unset` 清理；`hermes mcp add` → `test`（`✓ Connected (911ms) / ✓ Tools discovered: 8`）→ `remove` 清理。**两份宿主配置测后与备份 diff 均为 0 行**（`config.yaml.bak-p2hosttest-*`、`openclaw.json.bak-p2hosttest-*`），无 cogmem 残留
- 2026-10-23 02:52 — 新增 1 个守卫测试 `mcp-hosts.md names the commands that actually exist in each host CLI`，断言文档含 `openclaw mcp unset <name>`、`hermes mcp remove <name>`、`mcp-session-id: $SID`、`notifications/initialized`，且不含 `openclaw mcp remove`(未被否定语境的)与"piping the answers in does not work"。已验证旧文案确实会让该断言失败（`openclaw mcp remove` 正则匹配 true），非空断言
- 2026-10-23 02:52 — 测试真实结果：`bun test __tests__/release-metadata.unit.test.ts` **11 pass / 0 fail / 137 expect**；`bun run typecheck` exit 0；全量 `bun test __tests__` **1514 pass / 2 fail / 1516 tests / 163 files**，2 fail 仍是原两条基线（outbox 分页 13.7s 超 10s 预算、init dry-run 与本机 Ollama 384 维断言不符），未改断言
- 2026-10-23 04:15 — **P2b 完成 + 修掉一个真实缺陷**。stdio 章节：`cogmem-mcp` 是 bin 条目、仅全局安装后在 PATH（本机未装，`~/.npm-global/bin` 无 cogmem），用 `npm pack` + 临时 prefix 装包装实跑 stdio，`initialize`/`tools/list` 回逐行 JSON-RPC（非 SSE）；补上"仓库内改指 `dist/bin/mcp.js`"与"`--db` 父目录必须已存在，否则 `unable to open database file`"两条。systemd 章节：四个 ExecStart 变体逐个装 unit 实跑 —— `%h/.local/bin/cogmem` 与裸 `cogmem` 都 `203/EXEC`（后者因 `systemctl --user show-environment` 的 PATH 不含 `~/.npm-global/bin`/`~/.local/bin`），npm 包装器绝对路径与 `bun <abs>/dist/bin/mcp.js` 都 `active (running)` 且 `tools/list` 返回 8；`npm config get prefix` 本机是 `/home/ubuntu/.npm-global`，文档原写的 `~/.local/bin` 是错的。**缺陷**：`dist/bin/mcp.js` 是 00:20 过期产物，比 `src/bin/mcp.ts`（01:02 后改）多一段裸开 `Database` + `SqliteSharedMemory` 的代码，在 kernel 之前建出 `shared_items`，空库被判 `unsupported_database_identity`，HTTP 启动即退码 1（stdio 因走另一条路被掩盖）。`bun run build` 重建后消失，dist 相对 HEAD 变化 20 项。测试：`bun test __tests__/release-metadata.unit.test.ts` **13 pass / 0 fail / 146 expect**；`bun run typecheck` exit 0；全量 `bun test __tests__` **1516 pass / 2 fail / 1518 tests / 163 files**（2 fail 仍是原两条基线）。`bun scripts/verify-packed-migration.ts` → `packed 4.0.0 types, schema31 -> 0032, schema32 runtime, OpenClaw 0.7.2, and MCP verified`。新增 2 个守卫测试（stdio/systemd 指令、dist 与 src 一致性），已验证对旧 dist 与旧文档都会失败（非空断言）
- 2026-10-23 02:05 — **阻断**：cron 自检两次均 `HTTP 429 当前余额较低，任务过多，请充值`。调度链路正常（按时触发、有 run 记录），模型侧被 provider 拦。需用户决定 pin 到 magpie 或充值，详见下节

## 阻断已解除（2026-10-23 02:20）

模型 pin 到 `magpie/auto/deepseek-v4.1-flash` 后，cron 任务恢复：
`Last run 05:54 ok`，02:20–06:10 之间自主完成 P2 文档实测、过期 dist 缺陷修复、
WAL 改造与 `--no-probe` 修复，测试从 1516/2 走到 1520/0。

原始故障记录保留如下。

```
RuntimeError: HTTP 429: {"error":{"code":"429","message":"当前余额较低，任务过多，请充值"}}
```

链路已验证的部分：调度器在 `hermes-gateway`（systemd user 单元，linger 已开）里运行，trigger / 记录 / 交付都正常。
失败的部分：作业跟随主模型 = `zen / whatstoken/deepseek-v4.1-flash-1017`，该 provider 返回 429。

可选修复（模型 pin 属于用户权限，agent 的 cron 工具明确不能设置）：
```bash
hermes cron edit 3512049a4f26 --provider magpie --model auto/deepseek-v4.1-flash
```
或充值 whatstoken 余额。
