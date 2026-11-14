# 常驻形态升级（5.0 升级完成项，#165）

内核的 CLI 形态升级（`cogmem update`，停服 → 换版 → 迁移 → 健康门 → 启服 → 回滚）由 #150 落地。
这一份记录的是**常驻形态**：壳（`cog` 的常驻进程）如何在自己身上走完同一个生命周期，以及
Ryu 2026-11-12 定的五条要求各自落在哪一行代码、哪个判别测试上。

```
/upgrade <新版目录>
```

## 五条要求 → 实现 → 判别

| # | 要求 | 实现 | 判别测试（`test/upgrade.test.ts`） |
|---|---|---|---|
| ① | 升级前在对话里低打扰预告将断线 | `/upgrade` 的返回是一条 `receipt`（回执，不是模型说的话），写明 `from → to` 与「下线一会儿、回来报结果」；同时落 `upgrade_announced` 证据 | `IDLE stages, promises the report, announces the version delta and hands off` |
| ② | 只从静默态升级 | `CompanionShell.upgrade` 的第一道门：`IDLE` / `DORMANT` 之外一律拒绝（`RUNNING`、`DREAMING`、`WAKING`），拒绝是一次回执 + `upgrade_refused` 证据，不落快照、不写请求、不留承诺 | `RUNNING refuses and says why…`、`DREAMING refuses…` |
| ③ | 完成必回报；回报本身是承诺、完成自动关 | 承诺 = F2 的醒来意图（`wake_reason: upgrade_report:<id>`），在**任何东西可能下线之前**写入 checkpoint；回报被说出时 `consumeWakeIntent` 自动关。回报面 = 附着时的「你不在时发生了什么」+ 行式通道打印 | `a completed outcome is reported once…`、`a due promise with no records left is reported…` |
| ④ | 失败与回滚也必报；升级后沉默是 veto 级失败 | 监督进程**每一条退出路径**都写 `<dataDir>/upgrade/last.json`；下次起壳时 `settleUpgradeReport` 说出它。请求还在、监督进程已死、没有结果 ⇒ 报「升级后沉默」并关承诺 | `a rolled-back outcome is reported…`、`a request whose supervisor is gone is reported as a failure instead of silence` |
| ⑤ | 旁置安装 + 迁移前整脑快照 + 健康门 + 任一不过自动回滚 | 见下面的阶段表；回滚 = 恢复快照 + 服务指回旧树 + 起旧版 | 监督周期的 6 条测试（happy / gate 失败 / 启服失败 / 启动后 health 失败 / 停服失败 / 快照失败） |

## 阶段（`src/upgrade/supervisor.ts`）

壳自己**不做**这些事：一个进程在升级中途停掉自己再从自己身上换版，是「既不是旧版也不是新版」的
制造方式（`docs/install.md`、`src/install/AutoUpgrade.ts` 同一口径）。壳只写请求、记承诺、交接，
然后由监督进程全权负责：

| 阶段 | 做什么 | 失败时 |
|---|---|---|
| `stop` | 停正在服务的进程（有服务管理器走 `systemctl --user stop <unit>`，否则 `SIGTERM` 该 pid 并等它退出） | 报 `failed`，**什么都不改**：包、脑子、服务都还是原样 |
| `snapshot` | 迁移**之前**整脑快照（内核 `exportSnapshot`，单文件 + sha256），落到 `<dataDir>/snapshots/pre-upgrade-<from>-<时间>.snap` | 未迁移，重新拉起旧版；报 `failed` |
| `gate` | 用**新版自己的进程**开库（那次打开就是迁移）+ doctor 静态项 + 召回自检（写一条口令记忆再召回它） | 回滚 |
| `switch` | 服务指到新树（服务模式重写 unit 并 `daemon-reload`；无管理器则在启动参数里体现），然后启动 | 回滚（连刚起的 pid 一起停） |
| `health` | 新进程回 `/health`（外加既有 `runDoctor` 的活体项） | 回滚 |
| `report` | 写 `last.json`，无论成败 | —— |

回滚顺序：停掉在服务的进程 → 恢复快照 → 服务指回旧树 → 起旧版。恢复失败也照报，但会**点名**
「旧版服务着一份已迁移的脑子」和「旧版服务着自己的脑子」是两件不同的事实。

监督进程从**正在服务的那棵树**启动，而不是新树：负责回滚的代码必须是已知能跑的代码。新树是作为
一个「外来件」被检验的——`gate` 在它自己的进程里跑，所以一棵坏掉的新树会在切换之前就失败。

## 边界（写明，不假装）

- **快照的边界**：快照是内核数据库文件（`VACUUM INTO` 出来的整份，含壳自有的 `companion_soul` 表
  与一切同库表），带 `schemaVersion` / `embeddingDimension` / 校验和。壳侧那几份 JSON 状态
  （`checkpoint.json`、`routes.json`、`install.json`）不参与版本迁移，切换也不动它们。F19（#196）的
  整脑备份/搬家包/恢复演练仍是它自己的票；本轮的快照面是那里已有的「单文件、可校验、可恢复」形状，
  与 F19 的夜间自动轮换快照是**同一张脸的两个消费者**，不是两套。
- **健康门的分工**：切换**前**能跑的是「开库（=迁移）+ doctor 的静态项 + 召回自检」；`runDoctor` 的
  活体项（`/health`、附着 socket、服务单元）需要进程在跑，所以在切换**后**跑，它不过就回滚。这个
  顺序差是被写的，不是省掉的。
- **依赖是符号链接**：旁置树不复制 `node_modules`（几百 MB），只软链源树的。所以 staged 树的有效期
  等于它源树依赖的有效期；源树没有依赖时**拒绝**升级（`source_tree_has_no_dependencies`），不悄悄
  去联网装包。
- **服务模式的退出方式**：监督进程必须活过它自己执行的停服。有服务管理器时它作为自己的 transient
  unit 启动（`systemd-run --user --unit=… --collect`）；起不来就**拒绝**这次升级，而不是跑成一个会
  静默死在第一步的形状。无管理器时是 detached 子进程（停服只发信号给服务进程的 pid）。
- **正在服务的那棵树必须带升级模块**：老树没有 `src/upgrade/supervisor.ts` 就跑不了升级。5.0 之前
  的树属于这一类——现在没有用户，这条不是迁移问题；将来有用户时它才成为迁移问题。
- **承诺挂在 F2，不在 F16**：承诺册（F16，#193）还没落地，所以这条承诺是 F2 的醒来意图：它出现在
  「下次醒来」与时间语境里，`/commitments`（现在读的是 prospective memory）里暂时看不到。F16 落地时
  它应当被读成一条承诺，而不是另造一份。
- **没有自动/自作主张的升级**：只有用户点选的 `/upgrade`（或智能体提议、用户确认）会发起。ADR-0003
  的口径不变：关键动作人拍板。
- **召回自检会留下一条记忆**：口令那一条写进脑子，成功后留在库里——与 #203 首醒探针同一形状。没有
  写过东西的迁移不能算验证过。回滚时它随快照一起消失。

## 与 box 的关系

全周期实测在 box 上跑（停服 → 换版 → 迁移 → 启服 → 人为注入失败看回滚），box 用后清回首装态。
本轮报告的 box 一节写明实测到的是服务模式还是 `--skip-service` 模式，以及为什么。
