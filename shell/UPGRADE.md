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
| ② | 只从静默态升级 | `CompanionShell.upgrade` 的第一道门：`IDLE` / `DORMANT` 之外一律拒绝。票面点名的两种是 `RUNNING`、`DREAMING`；`WAKING`（时间语境注入的瞬间）也拒，因为「静默态」是这两个字的判据 | `RUNNING refuses and says why…`、`DREAMING refuses…` |
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
| `gate` | 用**新版自己的进程**开库（那次打开就是迁移）+ doctor 的静态项（数据目录 / 快照目录 0700）+ soul 可读 + 召回自检（写一条口令记忆再召回它） | 回滚 |
| `switch` | 服务指到新树（服务模式重写 unit 并 `daemon-reload`；无管理器则在启动参数里体现），然后启动 | 回滚（连刚起的 pid 一起停） |
| `health` | 新进程起来后跑**既有 `runDoctor` 全六项**：health 面、仅回环、附着 socket、内核身份与 dbPath、soul、服务单元/进程 | 回滚 |
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
- **健康门的分工**：`runDoctor` 的六项有四项需要进程在跑（health 面、仅回环、附着 socket、服务单元），
  所以健康门分两个时刻跑同一套口径：切换**前**跑不需要进程的那部分（开库=迁移、目录 0700、soul、
  召回自检），切换**后**跑**不改一行的 `runDoctor`**，两项的 check 合并进同一份结果文件——**同一项
  只出现一次**，带 `phase`（`pre-switch` / `post-switch`）说明是哪一半判的。健康门「先跑哪半」不是
  因为哪半不重要，而是因为一个已经停掉的进程问不出自己的健康。
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
- **承诺的到期时刻就是「沉默」的判定时刻**：请求文件写下与监督进程写下自己的 pid 之间不是原子的，
  所以在那之前任何一次 tick 都不能把「还没写 pid」读成「监督进程没了」——只有承诺到期（或请求本身
  已过宽限）而仍无结果，才判「升级后沉默」。这条边界有判别测试。
- **回报走两条面**：行式通道（`terminal_print`，所以 `settleUpgradeReport` 在插件起来**之后**才跑，
  否则没人在听）与附着时的「你不在时发生了什么」。一句话只报一次。
- **预告有交接宽限**：监督进程第一步之前先等 `handoffGraceMs`（1 s），让「我要下线一会儿」那条回执
  先落到 socket 上——不然预告会晚于它要预告的断线到达。
- **`/upgrade` 不是 no-op 命令**：它是一次操作，不是一个「跑一次就该没有任何副作用」的批处理命令。
  在第一次的结果还没回来之前再发一次会被拒（在途闸）；结果落地之后再发一次是「再来一次」，会重新
  旁置、重新快照、重新过门——每一步都可重入，但整体不是幂等 no-op。文档这么写，是因为把它讲成
  幂等才是谎。
- **没有自动/自作主张的升级**：只有用户点选的 `/upgrade`（或智能体提议、用户确认）会发起。ADR-0003
  的口径不变：关键动作人拍板。
- **召回自检会留下一条记忆**：口令那一条写进脑子，成功后留在库里——与 #203 首醒探针同一形状。没有
  写过东西的迁移不能算验证过。回滚时它随快照一起消失。

## 谁发起

`/upgrade` 可以被用户直接敲，也在命令表上（`palette` / `resident` / `tui` 三面），所以智能体可以用
`propose_command` 提议它、由用户在会话里按 Enter 确认——这正是要求①「先预告」的生产面：预告不是系统
通知，是它开口说话。除此之外没有自动升级：没有定时器、没有检查到新版就自己动手，ADR-0003 的口径
不变。

## 与 box 的关系

全周期实测在 box 上跑（停服 → 换版 → 迁移 → 启服 → 人为注入失败看回滚），box 用后清回首装态。
本轮报告的 box 一节写明实测到的是服务模式还是 `--skip-service` 模式，以及为什么。
