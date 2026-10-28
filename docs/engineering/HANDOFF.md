# 交接文档 — 召回能力优化（第 1–82 轮）

> 给下一个会话。**先读这一页**，再读 `docs/engineering/4.0-issue-loop.md` 的 §4.92 与 §4.99–§4.101（那四节是当前唯一未结线索）。

## 状态速览

| | |
|---|---|
| 分支 | `feat/cogmem-4.0-multi-bot` |
| HEAD | `c34e5d9`（其后一个纯文档提交） |
| 门禁 | **1799 pass / 0 fail / 227 files**；`typecheck` 0；`bun run build` 0 |
| PR | **#60，OPEN + Draft** |
| 仓库 | `/home/ubuntu/projects/Cogmem` |
| box | `cogmem-test`（instabox），三个 host 均在机上 |

**绝对不要做**：合并 `main`、发 npm、打 tag、部署。PR 保持 Draft。4.0 未发布。

## 目标与三项可验证要求

> cogmem 作为记忆后端：**哪怕存入一年以上的对话记忆，也能把任何一个记忆捞出**，**时间越少越好，能在 500ms 内就好**；并且要**与 box 里三个智能体对话，确认它们的记忆后端确实在工作**。

三项**均已达成且均有可重跑的验证**：

| 要求 | 验证方式 | 结果 |
|---|---|---|
| 三个 host 的记忆后端可用 | `scripts/verify-host-memory.sh <box> <host>` | **openclaw / hermes / pi 均 PASS**（第 83 轮把 HEAD 构建装到 box 上复跑：3/3 PASS；#91 另用真实对话验证队列排空，见 §4.107） |
| 一年以上的记忆能捞出 | `__tests__/recall-older-than-a-year.unit.test.ts` | **6/6（366–1500 天，最长 4.1 年）** |
| **500ms 内** | 同上测试断言 `p95 < 500ms` | **年量级 p95 282ms，0/36 超限** |

补充证据：一年以内各档 8/8；年度语料（20,343 事件）20/20；延迟不随年龄上升。

## 运行环境（照做，否则会误判）

```bash
cd /home/ubuntu/projects/Cogmem
export TMPDIR="$PWD/.cogmem/tmp"      # 必须。否则 SQLite VACUUM 报 SQLITE_CANTOPEN
bun test __tests__                     # 约 4 分钟
bun run typecheck && bun run build
bun run ledger:check                   # 台账与 GitHub 对齐
```

box 操作（`scripts/verify-host-memory.sh` 里的模式）：

```bash
export INSTABOX_API_KEY=<key>
export INSTABOX_BIN=/home/ubuntu/.local/bin/instabox
export XDG_CONFIG_HOME="$PWD/.cogmem/xdg"   # 必须：否则 instabox 写 ~/.config/instabox/.lock 被沙箱拒（permission denied）
# 注意 PATH 顺序：/data/home/.npm-global/bin 必须在 /data/home/.bun/bin 之前，
# 否则会跑到 /data/home/.cogmem/pkg 里的旧 cogmem
```

## 本循环最有价值的产出：三个**静默失效**的记忆后端

**前 9 轮本机测量全绿、1795 个测试全绿，一个都没测出来。** 只有真实对话能发现——这正是目标要求「与它们对话确认」的价值。

| host | 缺陷 | 位置 |
|---|---|---|
| hermes | MCP 条目指向不存在的路径，**且重连也修不好**（只重写 args、从不重写 command） | `src/bin/connect.ts` |
| openclaw | `plugins.load.paths` 累积死路径 → **整个配置无效、agent 跑不起来** | `AutoMemoryPluginInstaller.ts` |
| openclaw | `before_prompt_build` 的 `event.prompt` 是**字符串**，插件当对象读 → **每轮召回静默跳过** | 同上 |

三者形状相同：**`connect` 报成功、配置里有 cogmem 字样、退出码 0——三者同时成立，而后端是死的。**

## 必须守住的度量规矩（本循环付出五次回退才换来的）

**五次「先前结论被后一轮测量推翻」，全部是度量设置问题，没有一次是实现错误：**

1. 判据用 issue 编号 → 顺带提及算命中、真答案算失败
2. **时钟未钉死** → 同一提交一小时前 5/18、一小时后 4/18；**并因此为一个 −2 分的退步记了一功**
3. **语料就是台账本身** → 追加记录即改变测量对象（67→72 节让评分 6→4，代码未动）
4. 两次**误读探测结果**（漏传 `publicEntrypoint`；把 `Object.keys` 的字符下标当成数组下标）

**现在仪器有三个不变量**：语料冻结（`__tests__/eval/corpus.md`）、时钟钉死（`NOW` 常量）、判据是章节标题的独特片段。

**操作要求**：**跨轮次比较数字前，先确认两次用的是同一条路径。** 改动的收益只有端到端指标能看见——**不要相信「看起来应该更好」**。

## 五次「自身道理成立但实测更差」的回退（都由门禁拦住）

| 改动 | 实测 | 代价 |
|---|---|---|
| 去重重排 | raw lane 交付 2→4 | 破坏「优先原始来源」 |
| `containsFiller` 整词匹配 | — | 评测 6→5 |
| 桶/实体门 | — | 评测 6→4 |
| 平票偏向原始账本 | 4→5 | **4 条红**（含「编译 lane 是默认首选路径」） |
| 放宽 raw lane 取宽 | 无变化 | 无收益 |

**五次都由整套门禁或明确测量拦住，没有一次靠临场判断。** 这是这个仓库最值得保留的东西。

## 上一轮唯一未结的线索：facet/atlas 层与 500ms 冲突 —— **已解除**（§4.102–§4.106）

按 §4.99 → §4.100 → §4.101 顺序读。收窄链：

1. **§4.99**：年量级库里 `memory_atlas_documents = 0`，一次维护 tick **96 秒**
2. **§4.100**：tick **有效**（跑完 14,271 份文档、6 种节点类型）。但 **atlas 填充后 p95 从 282ms → 2,858ms，36 次里 12 次破 500ms**
3. **§4.101**：**不是均匀变慢**。单实体查询 182–240ms 不受影响；**「多实体 + 多词项 + raw_ledger」这一类查询 2,849ms**，p95 的突破就是它

**§4.102 给出了答案**：多走的**不是** facet 图扩展、也不是实体解析，而是**两次同一个 `OR` 形状 + 两处读到用不到的东西**（方法级调用树计时定位）：

| 步骤 | 形状 | 份额 |
|---|---|---|
| `relatedEpisodeCards`（每卡一次 ×48） | `WHERE ... OR ...` → 只按 `project_id` **扫全表边**＋临时排序 | 1,569ms |
| `earlyAtlasItems` | **算了从不使用** → 每次召回读两遍 atlas | 两遍里的一遍 |
| `evidenceLimit: 1000` 透传 | 无时间 facet 时白 hydrate ~940 条事件，读取只看第一条 | 175ms |
| `getThreadEvents`（每条返回记忆一次） | 同一个 `OR`，绕开**专为它建的**线程索引 | 209ms |

四个修复各自独立提交（`0f65aa7` / `dd67a72` / `9e07da5` / `c34e5d9`），各带一个**还原即变红**的测试。

**结果（同一会话、同一份语料，改动前后 + 两态）**：

| 状态 | p50 | p95 | 破 500ms |
|---|---|---|---|
| 改动前（`worktree` at `HEAD~4`，atlas 已填充） | 263.1ms | **2,855.4ms** | **12 / 36** |
| 改动后（atlas 已填充） | 172.7ms | **414.4ms** | **0 / 36** |
| 改动后（同副本清空 atlas） | 117.0ms | 206.8ms | 0 / 36 |

**填充后已低于原来「空」时的基线（§4.100 记 282ms）**——冲突的成因是**读取没有选择性**，不是 facet 层本身。

**收尾**：第 83 轮把 HEAD 构建装到 box 上真机复验，**#90/#91 已带证据关闭**（§4.107）。

**仍未做（都不阻塞三项要求）**：① 维护 tick 仍是一次 96 秒的**全量重建**，增量维护未做（本轮只解决「填满之后召回还能不能达标」）；② 张伟那条查询仍是九条里最慢的（403ms），剩下的大头是 `fallbackRawTextSearch` 的 LIKE 扫描（68ms，与 atlas 无关）与 `resolveTargetNodeIds` 的候选全表扫（33ms），**都还没动**。

## 其余未完成项（都不阻塞三项要求）

| # | 项 | 说明 |
|---|---|---|
| 1 | lane 选择重设计 | **§4.97 评估后降为低优先级**：冻结语料 4/18 测的是「词汇高度同质时纯词汇信号能走多远」，不是召回质量。入口点与已排除项见 §4.92/§4.95/§4.96 |
| 2 | `__tests__/eval/corpus.md` | 评审建议改用冻结的 git blob，而不是台账的副本 |
| 3 | lane 之外的评审判断项 | 已修完（类型去重、死参数、重复三元组、#96 台账行、connect 警告文案） |

## 台账即权威

`docs/engineering/4.0-issue-loop.md` 是**唯一权威记录**，§4.61–§4.106 覆盖本循环全部工作：每次改动的证据、效果、**更正**与未完成项。

- 每个修复是**独立提交**，`git revert` 任一即可，**且还原后对应测试会变红**（可验证的回滚）
- 每轮结果发到 PR #60 评论（`AGENTS.md` 要求）
- 改完 `docs/` 也要跑测试（仓库有文档策略测试）

## 四条最实用的经验

1. **`Object.keys` 看不出的东西，`typeof` 一看就出**（`event.prompt` 是字符串，`Object.keys` 给出的是字符下标，害我写错两次修复）
2. **用手写的、缺字段的配置去复现宿主行为，会制造出产品里不存在的故障**——必须用宿主**实际写入**的那份配置
3. **失败被记成「没有记忆」而不是「出错了」**——三个 host 缺陷都是这个形状；设计检查时优先找「静默降级」
4. **`WHERE` 里的 `OR` 会让整条复合索引失效**——本轮四个修复里有两个是同一个形状：`(a=? OR b=?)` 之下 SQLite 只用了最左那一列，等于扫全表。判断依据**不要靠读 SQL**，用 `EXPLAIN QUERY PLAN` 断言「有没有按锚点列定位」（`__tests__/memory-atlas-related-episode-read.unit.test.ts` 与 `__tests__/event-store-thread-read.unit.test.ts` 就是这么钉住的）。**同理，「算了没用」和「参数过宽」也是成本**：定位这类问题最快的工具是方法级调用树计时（本轮探针在 `.cogmem/`）。
