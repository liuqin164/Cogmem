# Cogmem 连续开发进度

> 唯一进度源。每轮开始读这里，每轮结束更新这里。
> 最后更新：2026-10-23 20:20 JST

## 当前状态

- 仓库：`~/projects/Cogmem`
- 分支：`main`
- HEAD：`877826c` feat(openclaw): support multiple bot workspaces with unique plugin IDs（本地提交，未推送、未打 tag）
- 上一个：`8c453a2`（fix: make plugin recall reach past conversations）、`df2dd21`（常驻内核）
- 版本：`4.0.0`，`publishConfig.access=public`，23 个 bin
- 工作区：**178 项未提交**，其中另一会话正在把 `src/migrations/0001..0031` 合并进
  `MigrationUtils.ts` + `MigrationDigestManifest.ts`，并改了
  `__tests__/cogmem-config.unit.test.ts`、`MemoryAtlasIndexer.ts`、`PrivacyDeletionRegistry.ts`、`internal.ts`。
  `dist/` 在 14:42 之前是干净的；14:42:59 另一会话跑了一次 build，现在 `dist/` 也被改动
  （84 个 `dist/migrations/*.js` 被删、8 个改），即它把 migrations 重构烘进了已跟踪产物。
  **17:33 另一会话补齐了 `CoreMcpTools.ts` 的三个 import handler**（`handleImportPreview` 1385 行、
  `handleImportApply` 1473 行、`handleImportStatus` 1819 行，走 `MarkdownSourceLoader` + adapter +
  `buildSources` 真实现，不是桩），17:38 又把三个工具加进 `ADMIN_TOOLS`。typecheck 因此转绿
- 测试：全量已在当前树上实测（20:19）：**1456 pass / 0 fail / 161 files / 5372 expect / 145.34s**。
  比 18:37 的 `1453 / 160 files` 多 3 个测试 1 个文件，即本轮新增的
  `__tests__/mcp-import-status.unit.test.ts`（3 个）。19:29/18:40 两轮 cron 都是模型侧
  `HTTP 400 duplicate field reasoning_content` 挂掉，没跑任何命令，工作区未被它们改动
- 类型检查：**绿**，`bun run typecheck` exit 0（17:44、17:52、20:12 各跑一次）
- dist：20:13 `bun run build` exit 0，`dist/mcp/CoreMcpTools.js` 含 `returnedSources` 与
  `limit must be a positive integer`（各 1 处）；`release-metadata` 的「dist entrypoint agrees with its source」通过
- 工具面审计：`bun evals/mcp/tool-audit.ts` **exit 0**（`total 40 / ok 27 / reachable 13 / defect 0`）。
  三个 `cogmem_import_*` 都在：`status` ok，`preview`/`apply` reachable（缺 `projectId` 时给业务前置错误）。
  17:05 之前那个 false-green 已修，所以现在这条 exit 0 是**真的**全通
- 发布门禁：pack **898 文件**（14:42 那次 `npm pack --ignore-scripts` 用的是 14:42:59 重建之前的干净 dist，
  与基线一致；现在 dist 已被改动，再 pack 数字会变）；`npm publish` 仍卡在未登录
- npm 登录：**未登录**（`npm whoami` → need auth），publish 需要用户 `npm login`
- 常驻服务：`bun src/bin/mcp.ts serve --config ~/.cogmem/config.toml --transport http --profile admin --port 7337`（12:11 起，多 bot 共享内核，勿停）

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

### P8 — 发布门禁在当前树上复跑（不需要授权，可直接做）

import 三工具落地、`dist` 20:13 重建之后，`npm pack` / `verify:packed-migration` 都还是
07:36 那次（在 import 功能之前）的数字。范围：`npm pack --dry-run --json` 数文件数、
`bun run verify:packed-migration` 看 `packed 4.0.0 ... and MCP verified` 是否仍成立、
确认 `dist/mcp/CoreMcpTools.js` 在包内且含 `returnedSources`。**不要**跑
`npm publish --dry-run`（会连带跑 `prepublishOnly`，约 4 分钟且会重建 dist）；
只查打包用 `--ignore-scripts`。仍是 `npm login` 未做，publish 本身留给用户。

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

### P6 — 已完成（2026-10-23 08:19）：测试不泄漏 MCP 子进程；孤儿来自手工命令

上一轮怀疑 `__tests__/mcp-execution.unit.test.ts` spawn 子进程后不 kill，**查证为假**：
该文件从不 spawn，全程 `startCogmemMcpHttpServer({...}, { port: 0 })` 在同一进程内起服务，
`afterAll` 里 `handle.stop()`。

那个存活 97 分钟的进程另有来源，证据链：

| 证据 | 值 |
|---|---|
| PID / 启动时间 | `3615853` / `Fri Oct 23 06:39:03 2026`（不是测试跑的时间） |
| 父进程 | `1160 systemd --user`（启动它的 shell 已退出，被 reparent = 孤儿） |
| 命令 | `bun src/bin/mcp.ts --transport http --port 7351 --bind 127.0.0.1 --db /tmp/dbg-deep/x/y/memory.db --profile core` |
| `--db` 指向 | `/tmp/dbg-deep` 已不存在（手工 `rm -rf` 后进程仍持有已删 inode） |
| 仓库内引用 | 全仓库只有 `docs/overnight-progress.md` 提到 `7351`/`dbg-deep`，`__tests__` 与 `evals` 中 **0 命中** |

即：某轮手工验证 `--db` 深层目录时用 `&`/后台方式起了一个真服务，没记 PID 也没 trap，
shell 一退就成了孤儿。唯一会后台起真服务的脚本 `evals/mcp/http-smoke.sh` 本来就有
`trap 'kill $SERVER_PID' EXIT`，所以不是脚本缺陷。

实测否证「测试泄漏」（两次快照对比，非推断）：

- 6 个 MCP 测试文件：43 pass / 0 fail / 251 expect，跑前 `bin/mcp` 进程集 = 跑后（仅那个孤儿），
  监听端口数 18 → 18
- 19 个 spawn 型测试文件（core-cli / memory-binding / episode-dream / agent-import 等）：
  166 pass / 1 fail（`memory-atlas-openclaw` 的 installer 测试，另一会话 08:11 正在改
  `AutoMemoryPluginInstaller.ts`，单独重跑即过，非本轮改动引起）/ 1286 expect，
  跑后进程集与端口数不变

**已做**：

1. 精确 `kill 3615853`（不是 `pkill -f`），确认 `ps` 退出、`ss` 的 7351 释放、全机 `bin/mcp` 归零
2. 新增 `evals/mcp/leak-check.sh`（可执行）：跑前/跑后比对 `bin/mcp` 进程集，有新增就打印
   pid + `lstart` + 监听端口并 **exit 2**，测试红也照样报，避免「测试全绿但进程漏了」这类不可见故障
3. 新增 `__tests__/process-hygiene.unit.test.ts` 3 个测试锁住两条泄漏路径：
   传输层测试必须在进程内起服务且 `stop()`（不得 `Bun.spawn`）；`evals/**/*.sh` 里凡后台起
   `bin/mcp` 必须有 `trap` + `kill`；leak-check 必须可执行且覆盖四个 MCP 测试文件
4. **非空已验证**：① 造一个后台服务再跑 leak-check → `LEAK: ... 3677482` + 端口 7361 + **exit 2**，
   杀掉后复跑 exit 0；② 临时放一个无 trap 的 `evals/mcp/untrapped-probe.sh` →
   守卫测试 `1 fail`（offenders 命中该文件），删除后 3 pass

### P7 — 已完成（2026-10-23 14:50）：装包后的插件入口存在且落在包内

结论：**没有缺陷**，`0d6fbf3` 的修法在全局安装布局下也成立。证据（全部真跑）：

| 检查 | 实测值 |
|---|---|
| `npm pack --ignore-scripts` | 898 文件，含 `package/dist/public.js`、`dist/host/openclaw/AutoMemoryPluginInstaller.js`、`dist/bin/mcp.js` |
| 临时 prefix 安装 | `npm install -g --prefix <tmp>/prefix --ignore-scripts <tgz>` → `<prefix>/lib/node_modules/cogmem` |
| 记录的 `publicEntrypoint` | `<prefix>/lib/node_modules/cogmem/dist/public.js`，`existsSync` **true**，`startsWith(pkgRoot+'/')` **true** |
| 第二候选（旧缺陷会落到的位置） | `<prefix>/lib/node_modules/dist/public.js`，**不存在** |
| 记录值能否被真实运行时加载 | 用记录的 `bunPath`（`/home/ubuntu/.bun/bin/bun`）跑 `bridge.mjs graph-explore` → 返回 `memory_atlas.v2` 正常结果，exit 0 |
| 幂等 | 第二次 `connect openclaw --auto` → `installed:false, alreadyCurrent:true, configUpdated:false` |
| `openclaw diagnose --json` | `installed:true, current:true, version 0.7.2 = expectedVersion`，4 个文件 sha256 全一致 |

两个语义澄清（写下来防以后误判）：

1. `candidates.find(existsSync) ?? candidates[0]` 在「两个候选都不存在」时返回的是**包内**的
   `dist/public.js`，不是包外路径。所以最坏情况是记录一个不存在的包内路径 → 加载时响亮失败
   （实测 exit 1，`Unable to load cogmem API. Tried file:///.../dist/NOPE.js: Cannot find module ...`），
   不会静默指向包外。
2. **OpenClaw 侧（Node）不能直接 import `dist/public.js`**：`dist/factory.js` 等 5 个文件 import
   `bun:sqlite`，Node 报 `ERR_UNSUPPORTED_ESM_URL_SCHEME: Received protocol 'bun:'`。这是设计如此
   （bridge 由 `bunPath` 起，index.js 只 spawn bridge，自己不 import 入口）。但也因此
   `bunPath` 必须是真 bun —— 见下一条新任务。

### P7b — 已完成（2026-10-23 16:25）：`--bun` 传错值不再静默安装，未知 flag 报错

修复点两处（`src/host/openclaw/AutoMemoryPluginInstaller.ts` 的 `assertBunRuntime` +
`src/bin/connect.ts` 的 `CONNECT_FLAGS` 白名单），本轮补上缺失的测试并端到端验证。

`assertBunRuntime(bunPath)` 在写任何文件之前 `spawnSync(bunPath, ['--version'])`：
不可执行 → `is not runnable (exit/errno)`；输出不以 `^\d+\.\d+\.\d+` 开头（Node 打印
`v24.16.0`）→ `reported "v24.16.0", which is not Bun`。`readArgs` 里未知 flag 直接抛
`Unknown option --<flag>. Known options: ...`，不再静默吞掉（`--bun-path` 就是这么丢的）。

实测（全部真跑，对 dist 产物）：

| 命令 | 结果 |
|---|---|
| `connect openclaw --auto --bun /usr/bin/node` | **exit 1**，`reported "v24.16.0", which is not Bun`；`openclaw.json` 仍是 `{}`，`extensions/` 未创建 |
| `connect openclaw --auto --bun-path /usr/bin/node` | **exit 1**，`Unknown option --bun-path. Known options: --workspace, ... --bun, ...` |
| `connect openclaw --auto --bun $(command -v bun)`（新 workspace） | **exit 0**，`autoMemory installed=true, alreadyCurrent=false, configUpdated=true`，记录 `bunPath=/usr/local/bin/bun` |
| 同上再跑一次 | `installed=false, alreadyCurrent=true, configUpdated=false`（幂等） |
| `node dist/bin/connect.js openclaw --auto`（无 `--bun`，`process.execPath`=node） | **exit 1** 且给出同一条解释。bin 的 shebang 是 `#!/usr/bin/env bun`，正常路径不会走到这里 |

新增 `__tests__/openclaw-bun-path-guard.unit.test.ts`（5 个测试）：非 Bun 被拒且不写配置、
不可执行路径报原因、真 Bun 通过、`--bun-path` 拼错报 `Unknown option`、CLI 端到端 `--bun /usr/bin/node`
退码 1 且 host 配置不变。**非空已验证**：临时把 `assertBunRuntime(bunPath)` 注释掉、把
`!CONNECT_FLAGS.has(key)` 短路成 `false && ...`，该文件 **1 pass / 4 fail**（含
`Expected: 1 / Received: 0`），还原后 5 pass。

顺带补 `usage()`：`--plugin-dir` / `--bun` / `--project` / `--agent-id` 原先不在帮助里，
现在未知 flag 会硬失败，帮助文本必须列全，并加一句 `--bun` 必须是真 Bun 的说明。

### P7c — 已完成（2026-10-23 18:33）：dist 与 src 已同步，`--help` 含 `--bun`（前提早已被别人满足）

本轮接手先验证，**没有再跑一次「第一次」的 build**：`dist/` 的 mtime 是 **17:49:29**（`dist/bin/connect.js`、
`dist/mcp/CoreMcpTools.js`、`dist/bin/mcp.js` 全部同一秒），晚于 `src/mcp/CoreMcpTools.ts` 的 17:33:43，
即**另一会话在 17:49 已经 build 过一次**，P7d 那轮记的「`--help` 不显示 `--bun`」在写下来时就已经过期。

实测证据：

| 检查 | 结果 |
|---|---|
| `node dist/bin/connect.js --help` | Usage 行含 `--bun <path>`，末行含 `--bun must be a real Bun binary`（共 3 处 `--bun`） |
| `grep -c CONNECT_FLAGS dist/bin/connect.js` | 3（白名单在产物里） |
| 我自己再跑 `bun run build` | exit 0，16s |
| build 前后 `dist/` 字节比对 | 解出 build 前的 `tar` 备份后 `diff -rq` → **0 差异，1234 文件对 1234 文件**，即 rebuild 是 no-op、dist 本来就跟 src 同步 |

结论：P7c 无需改动，证据是「rebuild 前后字节相同」。这也说明 `scripts/build.mjs` 的暂存+交换在
无变化时不会产生噪声。

**17:52 更新：阻塞已消失。** `bun run typecheck` exit 0，`bun run build` 的前置条件满足。
本轮没跑 build（本轮做的是文档/计数收口，一次只做一件），下一轮直接：
`bun run build` → 确认 `dist/bin/connect.js --help` 含 `--bun` → 顺手 `bun test __tests__`。
注意 build 会把当前工作区的 import 实现一并烘进已跟踪的 `dist/`，这是预期行为（`dist` 本来就脏）。

`dist/bin/connect.js` 的**行为**已是新的（`assertBunRuntime` 与 `CONNECT_FLAGS` 都在，本轮实测
全部命中），但 usage 字符串仍是旧的（`--help` 不显示 `--bun`），因为本轮没能重建 dist：
`src/mcp/CoreMcpTools.ts`（另一会话 16:02 写入）调用三个未定义的
`handleImportPreview / handleImportApply / handleImportStatus`，`bun run typecheck` 报 3 条 TS2304。
`bun run build` 因此拒绝交换（实测 `build failed; the previous dist/ was left untouched`，
dist 脏项 104 → 104，`dist.next` 已清），这正是 P4 那条修法在起作用。

等 `CoreMcpTools.ts` 能编译后：`bun run build` → 确认 `dist/bin/connect.js --help` 含 `--bun`
→ 顺手跑全量 `bun test __tests__`。

**17:05 复核：仍被阻塞，且阻塞物比上一轮记录的更具体**（不是缺 import，是缺实现）：

| 证据 | 实测 |
|---|---|
| `bun run typecheck` | 仍是那 3 条 TS2304（`handleImportPreview/Apply/Status`），其余零错误 |
| 三个工具的**定义** | `CoreMcpTools.ts` 525 / 556 / 588 行，`name` + 完整 `inputSchema`（`agent` enum、`workspaceRoot`、`sessionPaths`、`reindexRaw`…）+ `annotations` 都在 |
| 三个工具的 **switch 分支** | 697 / 699 / 701 行，调用同名 handler |
| handler 本体 | `grep -rn "handleImportPreview\|handleImportApply\|handleImportStatus" src/` → **只有这 3 处调用，零定义** |
| kernel 侧对应能力 | `grep -rn "importPreview\|importApply\|importStatus\|previewImport\|applyImport" src/` → **0 命中**，没有可直接接的 API |

所以这不是「补一行 import」，是**一个没写完的功能**：schema 与分支齐了、实现没有。导入语义（从 OpenClaw/Hermes 导出源 dry-run 扫描 → 幂等 ingest → 状态查询）需要设计，属另一会话
16:02 的在建工作，本轮**不代写**、也不删它的 schema 去骗绿。全量因此**首次在当前树上实测**：
`1448 pass / 2 fail / 1450 tests / 159 files`，2 个 fail 全是这三个工具造成的（详见「当前状态」）。

### P7d — 已完成（2026-10-23 17:52）：`cogmem_import_*` 三个工具已实现，文档与计数已对齐

方向选了 **1（补齐实现）**，但不是本轮做的：另一会话 17:33 写完了三个 handler，17:38 把三个工具
加进 `ADMIN_TOOLS`。本轮做的是**它的收尾**，因为登记了工具却没登记文档：

| 事实 | 实测 |
|---|---|
| handler 是真的 | `handleImportPreview` 1385 / `handleImportApply` 1473 / `handleImportStatus` 1819 行，走 `MarkdownSourceLoader` + adapter + `buildSources`，`preview` 返回 `recordsWouldIngest` 且 `recordsIngested: 0` |
| 真实注册计数 | `core 8 / admin 26 / full 40`（本轮用临时脚本直接读 `CORE_TOOLS.length` / `ADMIN_TOOLS.length` 实测，不是数文档） |
| 文档漂移 | `mcp-hosts.md` 写 `exposes 37 tools`、表里 `admin 23 / full 37`、第 233 行 `37 means full`；`README.md:818` 写 `8, 23, or 37`；`CHANGELOG.md:8` 写 `admin (23), full (37)`；三个 import 工具**在任何文档里 0 命中** |
| 唯一红测试 | `release-metadata` 的 `documented tool profile counts...`，`Expected: 23 / Received: 26` |

修法（文档跟着注册表走，不是把断言放宽）：

- `docs/mcp-hosts.md`：`37 → 40`、表 `admin 23 → 26`、`full 37 → 40`、`37 means full → 40 means full`；
  新增「Importing host history」一节，三工具表 + `agent`/`workspaceRoot`/`since`/`until` 语义 +
  `preview` 是 `readOnlyHint: true`
- `README.md:818`：`8, 23, or 37 → 8, 26, or 40`
- `CHANGELOG.md`：profile 计数 `23/37 → 26/40`，并补一条三个 import 工具的说明
- `__tests__/release-metadata.unit.test.ts`：`expect(admin).toBe(23) → 26`、`expect(full).toBe(37) → 40`、
  `37 means \`full\`` → `40 means \`full\``。**这是契约数字随注册表增长而更新，不是为了让测试变绿而放宽**：
  同一个测试仍然逐条比对文档字符串与注册表实算值
- **非空已验证**：临时把 `README.md:818` 改回 `8, 23, or 37` → 该测试 **14 pass / 1 fail**
  （`Expected to contain: "bounds the tool surface to 8, 26, or 40 tools"`），还原后 **15 pass / 0 fail / 160 expect**

**注意**：三个 import 工具目前**没有专门的单测**（没有「重复 apply 不重复写」那条）。工具面审计只证明
它们能被调用且不抛 `is not defined`，不证明幂等。这是 P7d 剩下的真实缺口，新列为 P7e。

### P7e — 已完成（2026-10-23 18:37）：补上幂等测试，过程中撞到并修掉两个真缺陷

`apply` 声称 `idempotentHint: true`，但**在写测试之前它根本不是幂等的**。本轮先写探针再写测试，
两次实测都不靠推断：

**缺陷 1（严重）：`cogmem_import_apply` 把调用方的 kernel 关掉了。**
`importSources` 与 `reindexRawSources` 的 `finally` 里各有一对
`input.kernel.cursorStore.close(); input.kernel.close();`，那是 CLI 时代 import 自己开 kernel 留下的收尾。
但 MCP 路径从不自己开 kernel（`openKernel()` 现在零调用，是死代码），拿到的是 runtime kernel；
HTTP 服务是「一进程一 kernel」（`src/mcp/http.ts:58-61` 把 `kernel` 塞进 shared runtime），
于是**一次 import 之后整个常驻内核被关掉**。实测（临时目录 + 真 kernel）：

| 调用 | 修前 | 修后 |
|---|---|---|
| `import_apply` #1 | `recordsIngested 2`，events 9 | 同左 |
| `import_apply` #2 | **`isError: true`，`{"error":"Cannot use a closed database"}`** | `recordsIngested 0 / skippedRecords 2`，events 仍 9 |
| 之后 `cogmem_recall` | **`{"error":"Cannot use a closed database"}`** | 正常，`items 1` |

修法：删掉两处 `finally`（连 `try {` 一起去掉并回退缩进）。kernel 的生命周期归
`callCogmemMcpTool` 的 `opened?.shouldClose` 与 http.ts 的 `ownsKernel` 管，handler 不拥有就不许关。

**缺陷 2（幂等性）：重复 apply 每次都多写一条 `BELIEF_UPSERTED`。**
修掉缺陷 1 后第二次 apply 能跑通了，但 `memory_events` 从 9 变 10。按 `event_type` 分组定位到
`BELIEF_UPSERTED` 1 → 2，其余四类（`RAW_EVENT_RECORDED` / `INGESTED` / `TOPOLOGY_COMPILED` /
`COGNITIVE_GRAPH_COMPILED`）都没动。根因：`InstalledBatchProcessor.runOnce` 无条件跑
`runOfflineWindow`，而 `kernel.consolidate()` 是**整窗重算**（`factory.ts:1729` 起按窗口重新 list
neurons/facts/events/beliefs 再跑离线管线），窗口里没有新东西时它只会把已有 belief 再 upsert 一次。
修法：`recordsIngested > 0` 才跑离线窗口，否则返回 `emptyOfflineOutput()`（新增的本地 helper，
九个字段全空数组）。这一改同时覆盖 CLI 的 import（同一个 processor）。代价写清楚：
若进程在 ingest 之后、consolidate 之前崩掉，重试会看到 0 pending 而跳过离线窗口，
需要靠 `cogmem_maintenance_tick` / dream tick 补，这一点已写进代码注释。

**新增测试** `__tests__/mcp-import-idempotency.unit.test.ts`（3 个）：
① 连跑两次 apply：第一次 `recordsParsed 4 / recordsIngested 4 / skipped 0`，第二次
`recordsIngested 0 / skipped 4 / sourcesChanged 0`，且 `memory_events` **按 event_type 分组逐行相等**；
② preview 是只读的（`dryRun true`、`recordsIngested 0`、跑完 `memory_events` 仍为 0），
且 `recordsWouldIngest` 与随后 apply 的 `recordsIngested` 一致；
③ import 之后同一个 kernel 仍可 `cogmem_recall` / `cogmem_remember_turn`（锁住缺陷 1）。
源数据是临时目录里 4 行最小 Hermes session markdown，不碰真库。

**非空已验证（两个修法各验一次，都真跑）**：
- 把 `kernel.cursorStore.close(); kernel.close();` 加回 `handleImportApply` 的调用点 →
  测试 ① 与 ③ **fail**（`Received: true`，即 `isError`），② 仍 pass → 1 pass / 2 fail；还原后 3 pass
- 把 `recordsIngested > 0 ? ... : emptyOfflineOutput()` 改回无条件 `runOfflineWindow` →
  测试 ① **fail**，diff 直接指出 `"event_type": "BELIEF_UPSERTED"` 的 `Expected - 1 / Received + 1`
  → 2 pass / 1 fail；还原后 3 pass

**dist 已重建**（`bun run build` exit 0）：`dist/mcp/CoreMcpTools.js` 里 `cursorStore.close()` **0 处**，
`dist/batch/InstalledBatchProcessor.js` 里 `emptyOfflineOutput` **2 处**（定义 + 调用）。
对**产物**又跑了一遍端到端（不是只跑源码）：`{a1:{i:2,err:false},n1:9, a2:{i:0,s:2,err:false},n2:9,
recall:{err:false,items:1}}`。

### P7f — 已完成（2026-10-23 20:19）：`cogmem_import_status` 的 `limit` 是空参数，描述还多报了两个不存在的字段

三个 import 工具里，`preview`/`apply` 在 P7e 有了测试，`status` 一直只有
`mcp-tools` 的名字清单命中，行为零覆盖。补测试时先跑探针，实测两处不符：

| 检查 | 修前实测 |
|---|---|
| 同一 project 两个源，`limit: 1` | `sources` 仍返回 **2 条**，`limit` 原样回显 1 → 参数是装饰 |
| `limit: 0` | 被 `\|\| 50` 吞掉，回显 `limit: 50`，调用方看不出自己传了非法值 |
| 工具描述 | 声称返回 "diagnostics, ingested/skipped counts"，实际返回的是每个源的 `sourcePath`/`sourceType`/`lastProcessedAt`/`processedRecordCount`，没有 diagnostics，也没有 ingested/skipped |
| `docs/mcp-hosts.md` 第 74 行 | 同一句过度声明（"processed source IDs, diagnostics, and ingested/skipped counts"） |

修法（三处，都是让声明跟实现对齐，不是加功能）：

- `handleImportStatus`：`limit` 必须是正整数（`Number.isInteger` 且 `>= 1`），否则抛
  `limit must be a positive integer`；`sources = processedRecords.slice(0, limit)`，新增
  `returnedSources`，`totalSources` 仍是过滤后的真实总数。切片稳定是因为
  `listRegisteredSources()` 本来就 `ORDER BY updated_at DESC, source_id ASC`
- 工具 `description` 改成实际返回的字段（path / adapter kind / last processed timestamp /
  already-ingested record count）并写明 `limit` 与 `totalSources` 的关系
- `docs/mcp-hosts.md`：表格同一行改写，并补一段 `limit` 语义（默认 50、正整数、截断 `sources` 而 `totalSources` 保留全量）

新增 `__tests__/mcp-import-status.unit.test.ts`（3 个，28 expect）：① 两个 session 文件 →
`totalSources 2`、`processedRecordCount` 为 `[2, 4]`、每个源有 `sourceId`/`sourceType`/`lastProcessedAt`；
② `limit: 1` → `sources` 1 条、`totalSources` 仍 2、`returnedSources 1`、两次调用首个源相同（顺序稳定）、
`limit: 0` → `isError` 且消息含 `limit must be a positive integer`；③ 未导入的 project 返回空列表、
status 前后 `memory_events` 行数不变、别的 project 看不到本 project 的源。

**非空已验证**：测试先写后修，修前 `bun test __tests__/mcp-import-status.unit.test.ts`
→ **2 pass / 1 fail**，失败点正是 `expect(body.sources).toHaveLength(1)` 收到 2；
修后 **3 pass / 0 fail / 28 expect**。

对 **dist 产物**也跑了一遍（不是只跑源码）：`limit=undefined → total 2 / returned 2 / echoed 50`、
`limit=1 → total 2 / returned 1 / echoed 1`、`limit=0 → isError "limit must be a positive integer"`。
`bun evals/mcp/tool-audit.ts` 仍 **exit 0**（`total 40 / ok 27 / reachable 13 / defect 0`，
`cogmem_import_status ok 0ms`）。

### P7d 原始描述（留档）

三选一，都得先定方向再动手：

1. **补齐实现**（原意）：`preview` 走 `src/bin/import-hermes.ts` / `import-openclaw.ts` 已有的源发现逻辑
   做 dry-run 计数；`apply` 走 recordRawEvent → ingest → consolidate → rebuildMemoryAtlas 幂等管道；
   `status` 读导入操作记录。三者都要有"重复 apply 不重复写"的测试。
2. **先下架**：从注册表摘掉这三个工具，回到 37 工具，等实现齐了再上。好处是发布面立刻自洽（文档 37、
   审计 defect 0），坏处是删另一会话的在建代码。
3. **保持现状**：`full` 40 / 文档 37 / 审计 exit 1 / 全量 2 fail。**不可发布**（`prepublishOnly` 会跑全量）。

推荐 1；2 需要另一会话确认那三个工具不是它正在写的。定了之后 P7c 才能跑 `bun run build`。

### P7b 原始描述（留档）

实测：`cogmem connect openclaw --auto --bun /usr/bin/node ...` → 安装返回成功，
`openclaw.json` 里 `config.bunPath = /usr/bin/node`，然后用它起 bridge →
`Unable to load cogmem API ... ERR_UNSUPPORTED_ESM_URL_SCHEME 'bun:'`。宿主只看得到
「插件已启用」，故障只在 gateway 日志里。范围：安装时校验 `bunPath`（`spawnSync(bunPath, ['--version'])`
输出须是 bun 形态，或直接试加载一次 entrypoint），不合法就抛错而不是写配置；顺带
`readArgs` 对未知 flag（如 `--bun-path` 误拼）静默忽略，改为报错。要新增 1 个测试并重建 dist。

### P7 原始描述（留档）

`0d6fbf3` 修的是 `defaultPublicEntrypoint()` 在 checkout 下记录 `src/public.js` 这个不存在路径的缺陷，
但**只验证了仓库内**（单测断言记录值 `existsSync`）。装着走的路径没验过：全局安装后
`here = <prefix>/node_modules/cogmem/dist/host/openclaw`，两个候选分别是
`<pkg>/dist/public.js` 与 `<pkg>/../dist/public.js`，后者会落到 `node_modules/dist/`，
一旦前者不存在就会记录一个包外路径。范围：`npm pack` → 临时 prefix 安装 → 读插件记录的
`publicEntrypoint`，断言它存在**且位于安装前缀内**；顺手确认 `dist/public.js` 在 pack 清单里。
只读 + 临时目录，不改产品行为。**注意**：当前 `dist/host/openclaw/AutoMemoryPluginInstaller.js`
是另一会话未提交的改动，跑之前先确认它已落提交，否则验的是半成品。

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

- 2026-10-23 20:19 — **P7f：`cogmem_import_status` 的 `limit` 原本是空参数，描述与 `mcp-hosts.md` 都多报了两个不存在的字段**（cron 轮；接手时 `docs/overnight.lock` 是 19:21:47 写的，已过期 2914s，判过期后接管；`src/`、`__tests__/` 最近 2h 只有 18:37 我自己的写入，另一会话无新动作）
  ① 接手先量状态：`git log` 仍 `877826c`，工作区仍是那 178 项未提交。18:40 与 19:29 两轮 cron 都是模型侧 `HTTP 400 duplicate field reasoning_content` 挂掉，**没跑任何命令**，所以进度文件里的 18:37 数字仍是接手时的真实基线（1453/0/160 files）
  ② 选任务的理由：三个 import 工具里 `preview`/`apply` 在 P7e 有了行为测试，`status` 只有 `mcp-tools` 的名字清单命中，**行为零覆盖**。这是 P7e 之后唯一还敞着的 import 缺口
  ③ 先跑探针再写断言（不猜）：同一 project 下两个 session 文件 → `import_apply` 得 `sourcesScanned 2 / recordsIngested 6`，随后 `import_status` 返回 `totalSources 2`、两个源的 `processedRecordCount` 为 4 和 2。**但 `limit: 1` 仍返回 2 条**，`limit: 0` 被 `|| 50` 吞掉并回显 50。同时发现工具 `description` 声称返回 "diagnostics, ingested/skipped counts"，实际一个都没有；`docs/mcp-hosts.md:74` 是同一句过度声明
  ④ 修法（三处，全是让声明跟实现对齐）：`handleImportStatus` 里 `limit` 必须正整数否则抛 `limit must be a positive integer`，`sources = processedRecords.slice(0, limit)`，新增 `returnedSources`，`totalSources` 保留全量；工具描述改写成实际字段；`mcp-hosts.md` 表格同一行改写 + 补 `limit` 语义一段。切片稳定是因为 `listRegisteredSources()` 本来就 `ORDER BY updated_at DESC, source_id ASC`
  ⑤ 新增 `__tests__/mcp-import-status.unit.test.ts`（3 个 / 28 expect）：两源计数 `[2,4]`、`limit: 1` 截断但 `totalSources` 仍 2 且两次调用首源相同、`limit: 0` 报错、未导入 project 空列表、status 前后 `memory_events` 行数不变、跨 project 不可见
  ⑥ **非空已验证**：测试先写后修，修前该文件 **2 pass / 1 fail**（`expect(body.sources).toHaveLength(1)` 收到 2），修后 **3 pass / 0 fail / 28 expect**
  ⑦ `bun run typecheck` **exit 0**（20:12）；`bun run build` **exit 0**（20:13），`dist/mcp/CoreMcpTools.js` 含 `returnedSources` 与 `limit must be a positive integer` 各 1 处；对 **dist 产物**实跑：`limit=undefined → total 2 / returned 2 / echoed 50`、`limit=1 → total 2 / returned 1 / echoed 1`、`limit=0 → isError "limit must be a positive integer"`
  ⑧ `bun evals/mcp/tool-audit.ts` **exit 0**（`total 40 / ok 27 / reachable 13 / defect 0`，`cogmem_import_status ok 0ms`）；全量 `bun test __tests__` **1456 pass / 0 fail / 161 files / 5372 expect / 145.34s**（= 18:37 的 1453 + 本轮 3 个，+1 文件，+28 expect 与测试文件逐条对上）
  ⑨ 本轮只碰 `src/mcp/CoreMcpTools.ts`（description + `handleImportStatus`）、`docs/mcp-hosts.md`、新增 1 个测试文件、`docs/overnight-progress.md`，外加 `bun run build` 烘出的 `dist/mcp/CoreMcpTools.js`。未碰其它 `src/`、未 commit。下一项 P8：在 import 落地后的当前树上复跑打包门禁

- 2026-10-23 17:52 — **收口 `cogmem_import_*`：文档与工具面计数从 23/37 对齐到真实的 26/40，全量转绿**（cron 轮；接手时无 `docs/overnight.lock`，17:43 接管；另一会话 17:33–17:40 仍在写，最后一次写入距我接手 3 分钟）
  ① 接手先量真实状态，不继承上一轮的结论：`bun run typecheck` **exit 0**（上一轮还是 3 条 TS2304）。原因不是它自己修好了，是**另一会话 17:33 补齐了三个 handler**：`handleImportPreview` 1385 行、`handleImportApply` 1473 行、`handleImportStatus` 1819 行，走 `MarkdownSourceLoader` + adapter + `buildSources`，`preview` 返回 `recordsWouldIngest` 而 `recordsIngested: 0`。17:38 又把三个工具加进 `ADMIN_TOOLS`。**P7c 的阻塞已消失**
  ② 工具面审计复跑：`bun evals/mcp/tool-audit.ts` **exit 0**，`total 40 / ok 27 / reachable 13 / defect 0`。三个 import 工具：`status` = ok，`preview`/`apply` = reachable（缺 `projectId` 时给业务前置错误，不是 `is not defined`）。上一轮修的 false-green 现在给出的是**真**绿灯
  ③ 撞上的真问题：**登记了工具，没登记文档**。实测注册表 `core 8 / admin 26 / full 40`（临时脚本直接读 `CORE_TOOLS.length` / `ADMIN_TOOLS.length`，不是数文档），但 `mcp-hosts.md` 仍写 `exposes 37 tools`、表里 `admin 23 / full 37`、第 233 行 `37 means full`；`README.md:818` 写 `8, 23, or 37`；`CHANGELOG.md:8` 写 `admin (23), full (37)`；三个 import 工具在**全部文档里 0 命中**。`release-metadata` 的计数测试因此是唯一红：`Expected: 23 / Received: 26`
  ④ 修法：文档跟注册表走。`mcp-hosts.md` 改 40/26/40 + `40 means full`，并新增「Importing host history」一节（三工具表、`agent`/`workspaceRoot`/`since`/`until`、`preview` 的 `readOnlyHint: true`）；`README.md` 改 `8, 26, or 40`；`CHANGELOG.md` 改计数并补一条三个 import 工具的说明；`release-metadata` 的契约数字 `23→26`、`37→40` 与 `37 means → 40 means` 同步。**没有放宽断言**：同一个测试仍逐条比对文档字符串与注册表实算值
  ⑤ **非空已验证**：临时把 `README.md:818` 改回 `8, 23, or 37` → 该测试 **14 pass / 1 fail**（`Expected to contain: "bounds the tool surface to 8, 26, or 40 tools"`），`cp` 还原后 **15 pass / 0 fail / 160 expect**
  ⑥ 测试真实结果：`bun test __tests__/release-metadata.unit.test.ts` **15 pass / 0 fail / 160 expect**；`bun run typecheck` **exit 0**（17:44、17:52 各一次）；全量 `bun test __tests__` **1450 pass / 0 fail / 1450 tests / 159 files / 5318 expect / 151.34s**——**2 个 fail 清零，这是 import 工具落地后第一次全绿**
  ⑦ 本轮只碰 `docs/mcp-hosts.md`、`README.md`、`CHANGELOG.md`、`__tests__/release-metadata.unit.test.ts`、`docs/overnight-progress.md`。**未碰 `src/`、未跑 build、未 commit**，`dist` 脏项保持原样（build 留给下一轮 P7c，否则会把另一会话刚写完的 import 实现和文档收口混在同一轮，验不清）
  ⑧ 留下的真实缺口（新列 P7e）：三个 import 工具**没有任何单测**。审计只证明它们能被调用、不抛 `is not defined`，不证明 `idempotentHint: true` 是真的。`apply` 声称 `recordRawEvent → ingest → consolidate → rebuildMemoryAtlas` 且幂等，需要一条「连跑两次，第二次 `recordsIngested: 0`、`memory_events` 行数不变」的真跑测试
  ⑨ 并发状态：另一会话仍不写锁（我 17:43 写入 `docs/overnight.lock`），17:33/17:38/17:40 有写入，之后到我收尾（17:52）无新写入。本轮改的文件与它改的文件零重叠

- 2026-10-23 17:10 — **修掉工具面审计的 false-green：`X is not defined` 被当成「可达」**（cron 轮；接手时无 `docs/overnight.lock`，16:54:54 接管；另一会话自 16:12 起无写入）
  ① 接手先复核 P7c：`bun run typecheck` 仍是 3 条 TS2304，`bun run build` 依设计拒绝交换，**P7c 仍被阻塞**。进一步取证发现阻塞物不是「缺 import」而是**缺实现**：三个 `cogmem_import_*` 的 `name` + 完整 `inputSchema` + `annotations` 都在（525/556/588 行），switch 分支也在（697/699/701 行），但 handler 在 `src/` 里**零定义**，kernel 侧也没有 `importPreview/importApply/importStatus` 这类 API。属另一会话 16:02 的在建功能，本轮不代写、也不删它的 schema 骗绿（新列为 P7d）
  ② **首次在当前树上实测全量**（13:45 之后没人量过）：`bun test __tests__` → **1442 pass / 2 fail / 1444 tests / 158 files / 5283 expect / 145.00s**。与 1535/167 的差不是回归，是另一会话删了 6 个 migration 相关测试文件（`git status` 里是 `D`）
  ③ 2 个 fail 同根因，不是两个问题：`cogmem_import_*` 已注册 → `full` 从 37 变 **40**，于是 `release-metadata` 的 `expect(full).toBe(37)` 收到 40；`mcp-tools` 的期望数组也没有这 3 个名字
  ④ **本轮真正修的东西**：`evals/mcp/tool-audit.ts` 的 `classify()` 只认 `unknown tool` / `TypeError|Cannot read|is not a function`，不认 `is not defined`，于是三个抛 `handleImportPreview is not defined` 的工具被判成 **reachable**，汇总报 `defect: 0` 且 **exit 0**——一个假绿灯的验证仪器。加一条 `ReferenceError|is not defined` → defect；并把执行段包进 `async function run()` + `if (import.meta.main)`，使模块可被测试 import 而不启动 kernel、不污染 `process.exitCode`
  ⑤ **实测对照（同一命令，改前/改后）**：改前 `{"total":40,"ok":26,"reachable":14,"defect":0}` **exit 0**；改后 `{"total":40,"ok":26,"reachable":11,"defect":3}` **exit 1**，3 条 defect 明细正是 `handleImportPreview/Apply/Status is not defined`。`import.meta.main` 守卫已验证不影响直接执行（审计照常输出 40 行）
  ⑥ 新增 `__tests__/tool-audit-classification.unit.test.ts` **6 个测试**：`is not defined` → defect、`ReferenceError:` → defect、`TypeError` 仍 defect、`unknown cogmem tool` 仍 defect、业务前置错误（`shared_item_not_found:`）仍 reachable、成功调用 → ok。**非空已验证**：临时删掉 `ReferenceError|is not defined` 那条分支 → **4 pass / 2 fail**，还原后 **6 pass / 0 fail / 7 expect**
  ⑦ 最终数字：`bun test __tests__/tool-audit-classification.unit.test.ts` 6 pass / 0 fail / 7 expect；全量 `bun test __tests__` **1448 pass / 2 fail / 1450 tests / 159 files / 5290 expect / 144.75s**（= 1442+6，2 个 fail 仍是 `cogmem_import_*`）；`bun run typecheck` 仍红，**只有**那 3 条 TS2304，本轮改的文件零错误（`evals/` 不在 tsconfig `include`，只 `src/**/*`）
  ⑧ 本轮只碰 `evals/mcp/tool-audit.ts`、新增 1 个测试文件、`docs/overnight-progress.md`。**未碰 `src/`、未跑 build、未 commit**，`dist` 脏项保持 104。临时文件 `~/.hermes/cache/scratch/list-tools.ts` 与 `/tmp/audit-*.txt` 为只读取证
  ⑨ 注意给下一轮：审计现在**故意 exit 1**，直到 `cogmem_import_*` 收口；谁跑 `evals/mcp/tool-audit.ts` 看到红不要当成新故障

- 2026-10-23 16:25 — **P7b 完成：`--bun` 传错值不再静默安装，未知 flag 硬报错**（cron 轮；接手时 `docs/overnight.lock` 内容 16:10:55 但已是 2640s 前写的，判过期后接管；另一会话仍在同一 worktree，且 16:02 把 `src/mcp/CoreMcpTools.ts` 改成半成品）
  ① 接手时的真实状态：P7b 的**实现**已在工作区（15:29 写入，未提交）——`AutoMemoryPluginInstaller.assertBunRuntime` 与 `connect.ts` 的 `CONNECT_FLAGS` 白名单，`dist` 也已在 15:29 之后重建过（`dist/bin/connect.js` 有 `CONNECT_FLAGS`/`Unknown option`，`dist/host/openclaw/AutoMemoryPluginInstaller.js` 有 `assertBunRuntime`）。缺的是测试，本轮补齐
  ② 新增 `__tests__/openclaw-bun-path-guard.unit.test.ts` **5 个测试**：非 Bun 被拒且 `openclaw.json` 保持 `{}`、`extensions/` 不创建；不可执行路径报 `is not runnable`；真 Bun（`process.execPath`）通过；`--bun-path` 拼错报 `Unknown option --bun-path`；CLI 端到端 `--bun /usr/bin/node` 退码 1 且 host 配置不变
  ③ **非空已验证**：临时注释掉 `assertBunRuntime(bunPath)`、把 `!CONNECT_FLAGS.has(key)` 改成 `false && ...` → 该文件 **1 pass / 4 fail**（其中 `Expected: 1 / Received: 0` 即修复前会静默成功），还原后 5 pass、0 fail、12 expect
  ④ 对 **dist 产物**实测：`--bun /usr/bin/node` → exit 1 + `reported "v24.16.0", which is not Bun`，`openclaw.json` 仍 `{}`、`extensions/` 未建；`--bun-path` → exit 1 + `Unknown option --bun-path. Known options: ... --bun ...`；`--bun $(command -v bun)` 新 workspace → exit 0、`autoMemory installed=true / alreadyCurrent=false / configUpdated=true`、记录 `bunPath=/usr/local/bin/bun`；再跑一次 → `installed=false / alreadyCurrent=true / configUpdated=false`（幂等）；`node dist/bin/connect.js`（`process.execPath`=node、无 `--bun`）→ exit 1 并给出同一条解释（bin shebang 是 `#!/usr/bin/env bun`，正常路径不触发）
  ⑤ 顺带补 `usage()`：`--plugin-dir` / `--bun` / `--project` / `--agent-id` 原先不在帮助文本里；未知 flag 现在硬失败，帮助必须列全，另加一句「`--bun` 必须是真 Bun」
  ⑥ **dist 没能重建**（新列为 P7c）：`src/mcp/CoreMcpTools.ts`（另一会话 16:02 写入）调用三个未定义的 `handleImportPreview/handleImportApply/handleImportStatus`，`bun run typecheck` 3 条 TS2304。`bun run build` 因此拒绝交换——实测 `build failed; the previous dist/ was left untouched`，`git status dist` 脏项 **104 → 104**、`dist.next` 已清，P4 那条修法确实挡住了「编译失败毁 dist」。所以 `dist/bin/connect.js` 的**行为**是新的、只有 `--help` 文本是旧的
  ⑦ 测试真实结果：`bun test __tests__/openclaw-bun-path-guard.unit.test.ts` **5 pass / 0 fail / 12 expect**；连同 `memory-atlas-openclaw` + `openclaw-bridge-daemon` 三个文件 **9 pass / 0 fail / 80 expect**；`bun run typecheck` **红**，但只有 `CoreMcpTools.ts` 那 3 条 TS2304，我改的两个文件零错误。**全量未跑**（全仓 tsc 已红，跑了只会得到与我这轮无关的红，基线仍是 13:45 的 1535/0/167）
  ⑧ 本轮只碰 `src/bin/connect.ts`（usage 一行）、`src/host/openclaw/AutoMemoryPluginInstaller.ts`（未改，实现已在）、新增 1 个测试文件、`docs/overnight-progress.md`。临时目录 `~/.hermes/cache/scratch/p7b-*` 已删。未 commit
- 2026-10-23 14:52 — **P7 完成：装包后的 OpenClaw 插件入口验证通过，无缺陷**（cron 轮；接手时锁的最后写入是 13:30，已过期 5.5h，另一会话仍在同一 worktree 重构 `src/migrations`）
  ① 真实链路：`npm pack --ignore-scripts`（**898 文件**，含 `package/dist/public.js`）→ `npm install -g --prefix <tmp>/prefix --ignore-scripts` → 用装好的 `cogmem connect openclaw --auto` 建插件，读 `openclaw.json` 里记录的 `publicEntrypoint` = `<prefix>/lib/node_modules/cogmem/dist/public.js`，`existsSync` **true**、`startsWith(pkgRoot+'/')` **true**
  ② 旧缺陷那条候选（`<prefix>/lib/node_modules/dist/public.js`）**不存在**；且 `candidates.find(existsSync) ?? candidates[0]` 在两个候选都缺时返回**包内**路径，所以最坏情况是响亮失败而不是静默指向包外。负向对照：把入口换成 `dist/NOPE.js` → bridge **exit 1**，`Unable to load cogmem API. Tried file:///.../dist/NOPE.js: Cannot find module ...`，没有回退到包名
  ③ 记录值确实能被真实运行时加载：用记录的 `bunPath`（`/home/ubuntu/.bun/bin/bun`，来自 `process.execPath`，因为 bin 是 bun shebang）跑 `bridge.mjs graph-explore`，返回 `{"version":"memory_atlas.v2",...}`，exit 0；`openclaw diagnose --json` → `installed:true, current:true, version 0.7.2 = expectedVersion`，4 文件 sha256 全一致；二次 `connect` → `installed:false, alreadyCurrent:true, configUpdated:false`
  ④ 澄清一条容易误判的事实：**Node 不能 import `dist/public.js`**（`dist/factory.js` 等 5 文件 import `bun:sqlite` → `ERR_UNSUPPORTED_ESM_URL_SCHEME 'bun:'`）。设计上 OpenClaw 侧 index.js 只 spawn bridge、由 bun 加载入口，所以这不是缺陷；但反过来说明 `bunPath` 必须是真 bun
  ⑤ **新发现（已列为 P7b）**：`connect openclaw --auto --bun /usr/bin/node` 安装**静默成功**，把 `bunPath` 原样写进 `openclaw.json`，之后每次 hook 都在 gateway 日志里报 `Unable to load cogmem API`。另：`readArgs` 对未知 flag（我误拼的 `--bun-path`）静默忽略，`--bun` 才是真名
  ⑥ 本轮**没有跑全量测试和 typecheck**：另一会话正在把 `src/migrations/0001..0031` 合并进 `MigrationUtils.ts`（14:42 仍在改），且 **14:42:59 它跑了一次 build**，把 84 个 `dist/migrations/*.js` 删掉、8 个改掉。此时跑全量得到的是与我这轮无关的红。我的 pack 在它重建之前（898 文件与基线一致），所以装包验的是已提交产物，不是半成品。本轮只碰 `docs/`，没动 `src/`、`dist/`、`__tests__/`；临时 prefix 安装目录已删除（`~/.hermes/cache/scratch/p7-run`）
  ⑦ 顺带观察：`~/.hermes/cache/scratch` 已 26G，与本项目无关，未清理（怕误删别的会话的产物）
- 2026-10-23 13:45 — **多 Bot 支持落地**（`877826c`）。OpenClaw 插件安装器现在按 workspace 生成唯一 plugin ID（workspace 路径 sha256 前 8 位），每个 bot 在全局 openclaw.json 里得到独立 plugin 入口（`cogmem-auto-memory-<hash>`），各自拥有独立 `projectId`、`workspace_dir`、`configPath`、`bridgeSocket`、`daemon`。实测 5 个 bot（susan、researcher、reviewer、writer、openclaw）全部在同一全局 openclaw.json 里共存，`projectId` 分别为 bot 名称。共享 HTTP kernel（端口 7337，admin profile）提供统一后端，项目隔离由 `project_scope_violation` 在存储层强制。

  OpenClaw gateway 运维问题（旧进程锁竞争、插件关闭超时、systemd PATH 缺失）导致 gateway 无法正常监听 18789 端口，属运维层面问题，不影响插件功能正确性。插件层面已通过 1535 测试全绿、手工 hook 验证（before_prompt_build 注入、agent_end 写入、sourceLocator 下钻、跨项目拒绝）完整验证。

- 2026-10-23 09:20 — **插件真机链路验证，抓到两个静默错误**。用 Node 直接加载插件、走 `register` 的 `before_prompt_build` / `agent_end`，发现注入块为空：①`isRawEventInRecallScope` 把 `threadId` 当硬过滤，跨会话的低信号轮次永远召回不到；②daemon 预热时没收到 `publicEntrypoint`，`loadCogmemApi` 回退到已安装的 cogmem 包并缓存，宿主实际跑的是旧模块。修法：线程内无证据时回退到全项目检索并打 `cross_thread` 标签；入口随预热传递，设了入口就不再回退包名。验证：注入 2206 字符、含 `Orion`，首轮 461ms、次轮 24ms。全量 **1535 pass / 0 fail / 167 files**
- 2026-10-23 08:45 — **常驻内核模式落地**（`docs/openclaw-runtime.md`）。OpenClaw 插件不再每轮 spawn 进程：bridge 增加 `serve` 模式，kernel 只开一次，hook 走 `<pluginDir>/run/bridge.sock`（0600）。实测同一库（1083 事件 / 91 神经元）：一次性路径 p50 **1008ms**，常驻路径 p50 **55ms**。插件 register 时启动并预热 kernel（约 1.2s，一次），daemon 挂掉自动重启，版本不符自动替换，锁文件防止同库双实例。连不上时回退一次性进程，保证正确性。新增 2 个测试；全量 **1533 pass / 0 fail / 166 files**
  - 期间修掉三个真问题：`PLUGIN_VERSION` 在插件模板里未定义导致自动启动静默失败；`Bun.connect` 在 Node（OpenClaw 运行时）不存在，改为 Node 用 `net`、Bun 用 `Bun.connect` 的双路径；socket 目录不存在导致 daemon 起不来
  - 清理了测试遗留的 13 个孤儿 daemon
- 2026-10-23 08:27 — **P6 完成：否证「测试泄漏 MCP 子进程」，孤儿来自手工命令，并已清掉**（cron 轮；接手时无 `docs/overnight.lock`，HEAD 已被另一会话推到 `470aaa2`）
  ① 上一轮的怀疑是错的：`__tests__/mcp-execution.unit.test.ts` 全 286 行没有一处 `Bun.spawn`，服务用 `startCogmemMcpHttpServer({...}, { port: 0 })` 在进程内起，`afterAll` 里 `handle.stop()`。`grep -rn "7351\|dbg-deep" __tests__/ evals/` → **0 命中**，全仓库只有进度文件自己提到过
  ② 孤儿取证：PID `3615853`，`lstart` = `Fri Oct 23 06:39:03 2026`（不是任何一次测试的时间），父进程 `1160 systemd --user` 即启动它的 shell 已退出被 reparent，`--db /tmp/dbg-deep/x/y/memory.db` 且 `/tmp/dbg-deep` **已不存在**（手工 `rm -rf` 后进程还握着已删 inode），`ss` 确认它独占 `127.0.0.1:7351`。唯一会后台起真服务的 `evals/mcp/http-smoke.sh` 自带 `trap 'kill $SERVER_PID' EXIT`，不是脚本缺陷
  ③ 两次快照对比实测（不是推断）：6 个 MCP 测试文件 `43 pass / 0 fail / 251 expect`，跑前跑后 `bin/mcp` 进程集完全相同、监听端口数 18 → 18；再跑 19 个 spawn 型测试 `166 pass / 1 fail / 1286 expect`，进程集与端口数仍不变。那 1 fail 是 `memory-atlas-openclaw` 的 installer 测试，另一会话 08:11:05 正在改 `src/host/openclaw/AutoMemoryPluginInstaller.ts`，单独重跑即过，不是本轮改动引起
  ④ 清理：`kill 3615853` 精确 PID（不用 `pkill -f`），`ps` 已退出、7351 released、全机 `bin/mcp` 归零
  ⑤ 防复发：新增 `evals/mcp/leak-check.sh`（可执行）跑前跑后比对 `bin/mcp` 进程集，有新增就打印 pid + `lstart` + 监听端口并 exit 2，专门抓「测试全绿但进程漏了」这种不可见故障；新增 `__tests__/process-hygiene.unit.test.ts` 3 个测试（传输层测试必须进程内起服务且有 `stop()`、`evals/**/*.sh` 后台起 `bin/mcp` 必须有 `trap`+`kill`、leak-check 必须可执行且覆盖四个 MCP 测试文件）
  ⑥ **非空已验证**：造一个后台服务（`--port 7361`）再跑 leak-check → `LEAK: ... 3677482` + 端口 7361 + **exit 2**，杀掉复跑 exit 0；临时放一个无 trap 的 `evals/mcp/untrapped-probe.sh` → 守卫测试 `1 fail`（offenders 命中该文件 `Expected - 1 / Received + 3`），删除后 3 pass
  ⑦ 真实数字：`bun run typecheck` exit 0；全量 `bun test __tests__` **1533 pass / 0 fail / 166 files / 5691 expect / 174.57s**
  ⑧ 并发告警：另一会话仍在同一 worktree 工作（07:35 提交 `0d6fbf3`、之后 `470aaa2`，08:11 起继续改 `AutoMemoryPluginInstaller.ts` 与其 dist 产物、`agent-import-cli` 测试，另加 `openclaw-bridge-daemon.unit.test.ts`、`docs/openclaw-runtime.md`）。它依旧从不刷新 `docs/overnight.lock`，锁协议事实上失效；本轮只碰 `__tests__/` 与 `evals/`，不碰它的 src/dist
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
