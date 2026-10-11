# 中立拍卖行入网页 + 跨市场倒卖 + 赚金功能规划

> 状态：**M1 + M2 已完成（10-11 实施，未提交）** · 日期：2026-10-11 · 对应 HEAD：`20172a7`
> 目标：让中立拍卖行（neutral）数据进入网页，提供与联盟拍卖行（faction）的跨市场比较，
> 找出两边有价差/数量差的物品用于倒卖；并评估其他赚金功能。

> **M1 进度（10-11）**：插件 0.3.8 zone 白名单判定（三角路口=neutral、主城=faction、未知回退阈值）
> 已部署哈希一致；watcher 独立游标导入 neutral 槽位；首页双新鲜度 + `/neutral` 只读页已上线
> （HTTP 200）；vitest 202 用例 + tsc 0 错。**待用户 /reload + 三角路口扫一次中立**，随后可开始 M2。
> M2 依赖的 DB 层已就绪（market 列、按市场查询、getNeutralMarketLatest）。

> **M2 进度（10-11）**：跨市场倒卖面板已实现 —— `/arbitrage` 页（联盟/中立最新轮配对，价差%、
> 方向、预计净利、量差、陈旧门槛 + URL 参数筛选排序）；`src/lib/cross-market.ts` 纯函数 +
> 4 用例；`getCrossMarketSides()` 配对查询；费率常量 `src/data/market-fees.ts`（5%/15% 经典值，
> 待实测）。vitest 206 用例 + tsc 0 错 + build 成功。**当前 DB 无 neutral 行，页面显示空态
> "已有联盟数据，但还没有中立数据"** —— 用户扫完中立即有真实比较结果。

## 1. 背景与现状（已核实）

- 插件 0.3.7（`WoWderhoiAH.lua` `finishScan`）已能区分两个市场：宽限期外按挂单总数
  ≥20000 判 `faction`，否则 `neutral`；**中立扫描写 `WoWderhoiAHDB.neutralScanData`
  独立槽位**（结构同 scanData：`dataVersion/scannedAt/server/faction/market/items`），
  不覆盖主城数据、不写 Points、**当前不进网页**（有意设计，防污染）。
- 网页 `AuctionSnapshot` 已有 `market` 列（默认 `"faction"`）+ 索引
  `[server, faction, market, timestamp, source]`；6.20 起全部查询按 `market='faction'` 过滤。
- `watch-savedvars.ts` 只读 `WoWderhoiAH_ScanData`（或 `DB.scanData`）导入，`neutralScanData`
  从未被读取；`.watch-state.json` 只有一个 `lastImportedScanAt` 游标。
- 中立市场特点：物品少（实测 ~2000 挂单条/523 种商品）、扫描慢、价格天然与联盟有差异
  （联盟/部落玩家互不直接交易，中立是唯一跨阵营通道）。
- **中立拍卖行实际位置（用户 10-11 确认）**：艾尔文森林 ↔ 赤脊山交界（三角路口 =
  艾泽拉斯贸易局/板条箱提交点，foreverchanges 附魔页坐标 11.2, 71.4），**非经典热砂港三处**。
  对联盟角色极近、部落需跑路 → 中立市场供给可能偏联盟，倒卖时留意。具体 `GetRealZoneText()`
  返回艾尔文森林还是赤脊山，待游戏内实测（交界处返回当前所在 zone）。

## 2. 总览

三个里程碑，逐级交付、各自可验证：

```
M1 中立数据进网页（管道打通，网页可见中立市场）
  └─ M2 跨市场倒卖比较面板（本次核心功能）
      └─ M3 赚金功能增强清单（选做，逐项评估）
```

## 3. M1：中立数据进网页

**改动点（全部沿用现有架构，不新建概念）：**

| # | 位置 | 改动 |
|---|---|---|
| 1 | `scripts/watch-savedvars.ts` | `importLatestScan` 后新增 `importNeutralScan()`：读 `parsed.WoWderhoiAHDB.neutralScanData`，版本门禁（`dataVersion===SCAN_PIPELINE_VERSION`）+ **独立游标** `lastImportedNeutralScanAt`（写 `.watch-state.json`），POST 到同一 `/api/import/addon-scan`（body 带 `market:"neutral"`）；复用 `importInFlight` 锁或独立锁 |
| 2 | `src/app/api/import/addon-scan/route.ts` + `src/lib/addon-scan.ts` / `scan-import.ts` | 确认 market 字段完整透传落库（6.20 已实现，需补测试覆盖 neutral 路径）；normalize 保持"仅显式 neutral 为 neutral" |
| 3 | `src/lib/repositories.ts` 等 | 现有查询函数 market 参数化（多数已按 `market='faction'` 过滤）；**新增按市场取最新轮/列表**的查询即可，faction 语义不动 |
| 4 | 页面 | 首页/雷达头新增市场维度展示：当前"联盟数据更新于 X"改为"联盟 / 中立"双状态（复用 `freshness.ts`）；中立数据只读展示，**不并入雷达、不进 med7、不进账本统计** |
| 5 | 插件 `WoWderhoiAH.lua` | **市场天然标识=当前区域**：`finishScan` 记录 `zone = GetRealZoneText()`（或 `C_Map` mapID）写进 scanData / neutralScanData；判定改为**区域白名单优先、挂单数阈值兜底**（主城区域→faction，三角路口区域→neutral，白名单外回退现行阈值） |

**决策点（实施时定，不阻塞规划）：**
- 中立是否积累 Points 历史：中立扫描频率低（用户手动去中立 AH 扫），建议**先只存快照**、
  不做 med7/走势；若后续扫得勤再开 Points（按 market 隔离，工程量小）。
- 中立日线（DailySummary）：M1 不做，比较用"最新轮"即可。
- **区域白名单需实测**：三角路口交界处 `GetRealZoneText()` 的确切返回（艾尔文森林/赤脊山/
  边界区域名）——用户在中立 AH 位置打一次即可定；主城一侧顺手记暴风城/铁炉堡/达纳苏斯。

**验收**：用户在游戏内扫一次中立 AH → /reload → 网页能看到"中立市场"及其物品/价格/
新鲜度；联盟数据不受影响；`market` 分布出现 `neutral` 行。

## 4. M2：跨市场倒卖比较面板（核心）

### 4.1 数据配对

- 查询：`(itemId, market)` 两市场各自**最新一轮**快照 join（复用 `getMarketUniverse`/
  `getLatestLadders` 的窗口函数思路，按 `(item_id, market)` 取 MAX(timestamp)）。
- 只比较**两市场都出现过**的物品（一方没有则无套利机会，不显示或置灰）。
- 新鲜度门槛：任一方最新轮超过 N 天（建议 7 天，可配）→ 标"陈旧"，不参与"可操作"判定。

### 4.2 指标

| 指标 | 口径 | 用途 |
|---|---|---|
| 价差% | `abs(factionP10 - neutralP10) / min(两边P10)` | 排序主指标 |
| 方向 | faction 便宜 → 联盟买、中立卖；反之亦然 | 操作指引 |
| 两边在售量 | faction/neutral 各自最新轮 `quantity` | 买入侧深度、卖出侧空间 |
| 最低档价 | 两边 ladder 第 1 档（已有 `rawPayload.ladder`） | 真实买入成本（不是 P10） |
| 预计毛利 | 卖侧 P10×(1−卖侧费率) − 买侧最低档价 | 净利估算 |
| 挂单数 | 两边挂单笔数 | 卖出流动性与竞争 |

### 4.3 费率与成本（需实测，做成配置常量）

- 经典怀旧服：普通拍卖行成交费 5%，**中立拍卖行 15%**（押金更高、未成交不退）。
- Forever 私服可能魔改 → **实施时进游戏实测一次**，写入 `src/data/market-fees.ts` 或
  Settings，常量可调。
- 倒卖还有机会成本：**中立 AH 在三角路口（艾尔文森林↔赤脊山交界）**，联盟角色很近、
  部落要跑路——方向文案可提示；批量倒卖时跑图成本不可忽略。

### 4.4 页面

- 新增页签/页面"跨市场"（放首页雷达旁或独立路由 `/markets`，倾向**首页雷达同级的
  第二个 tab**，复用 deal-radar 表格样式与 money 格式化）。
- 筛选：最小价差%（默认 30%）、最小买入侧数量、只看"可操作"（两市场均新鲜）。
- 排序：预计净利 / 价差% / 数量差，默认净利降序。
- 行点击 → 跳单品页（未来可加市场切换）；行内提示方向文案"联盟→中立"。
- 免责标注：中立价可能陈旧、费率以游戏为准、低量物品慎倒。

### 4.5 防污染（红线）

- neutral 数据**只进跨市场比较面板**，绝不混入雷达/med7/走势/账本/配方利润的 faction 计算；
  现有架构天然隔离（查询按 market 过滤），新增代码继续遵守。
- 倒卖建议仅当买入侧最低档挂单量 ≥ 可买数时才给出"可操作"。

## 5. M3：更多赚金功能（评估清单，按价值/成本排序）

| 功能 | 说明 | 价值 | 成本 | 建议 |
|---|---|---|---|---|
| 1. 跨市场倒卖（M2） | 本次主线 | 高（中立是唯一跨阵营通道，价差天然存在） | 中 | 必做 |
| 2. 配方利润面板增强 | 现有面板用 P10 估成本；改为**材料用 ladder 最低档**买入、成品按 P10×挂单深度卖出，估算"实际能赚多少件" | 高（把"理论利润"变"可执行利润"） | 低-中 | 建议做 |
| 3. 挂单深度/扫货成本 | 雷达每行显示"买光最低档需花 Xg"、"按 P10 可出 Y 件" | 中-高（防低价单只有 1 件） | 低（ladder 已有） | 建议做 |
| 4. 波动/抄底信号 | 基于既有 Points：近 7 天低点 vs 现价反弹 ≥X%、或跌至 7 日区间下沿 → 提示囤货时机 | 中（开服期波动大） | 低-中 | 选做 |
| 5. 中立供给差高亮 | 跨市场面板突出"联盟有 100 件、中立只有 2 件"类物品（供需失衡，最典型的倒卖对象） | 高 | 低（并入 M2） | 并入 M2 |
| 6. 价格异动告警 | 关注物品（Watchlist 已 19 条）价格跌破/冲高 X% 时网页通知 | 中 | 中 | 选做 |
| 7. 每日市场机会 Top10 | 复用 `daily-summary.ts`，首页放"今日最佳倒卖/制造/抄底机会" | 中 | 低-中 | 选做 |
| 8. 阵营差异物品索引 | 联盟/部落限定配方、任务物品、职业材料清单（数据侧人工/半自动维护） | 中 | 高（需人工维护） | 暂缓 |

**不建议做**：跨服倒卖（单服）、机器人自动下单（违背游戏规则/风险）、预测模型（数据量不足）。

## 6. 风险与注意

- **中立数据新鲜度**：中立扫描要专程去野外，频率低 → 比较面板必须显示每侧"数据更新于 X"
  并设陈旧门槛，否则会基于过期价误导。
- **费率未实测**：15% 中立费率是经典值，Forever 需游戏内确认（成交一单看实收即可）；
  中立 AH 地点已确认（三角路口），区域白名单名待实测。
- **低流动性**：中立市场挂单少，"价差大"常常是 1-2 件挂单 → 数量门槛 + 挂单数展示。
- **防污染回归**：任何新查询都要过 `market` 过滤；加 vitest 用例钉死"neutral 不进 faction 口径"。
- **公测清空（用户待办）**：本功能是代码，公测清数据不冲突；M1/M2 上线后清空也照常工作。
- **部署纪律**：动插件才需部署游戏目录；M1 主要是 watcher+网页，改完按 §5 跑 tsc/vitest、
  重启 watcher（Program Files node），网页 Ctrl+F5。

## 7. 验证方案

- **M1**：vitest 新增用例（watcher 解析 neutral 槽位 → 独立游标推进；import 路由 market 落库）；
  真实链路：用户扫中立 → reload → `SELECT market, COUNT(*) FROM AuctionSnapshot GROUP BY market`。
- **M2**：比较查询单测（构造 faction/neutral 双快照 fixture，验证价差/方向/毛利计算）；
  页面渲染 + 筛选交互；用真实库（已有 faction 历史）跑一次看输出合理。
- 全量 `npx vitest run` + `npx tsc --noEmit` 0 错；部署后游戏目录哈希比对（若动插件）。

## 8. 不做的事（边界）

- 不合并两市场数据、不把 neutral 写进 DailySummary/Points/账本（除非用户后续明确要）。
- 不做自动下单/外挂类功能。
- 不引入新数据源（仍以插件扫描为唯一数据源）。
