# 数据源迁移规划：WoWderhoiAH 插件 → Auctionator

> 状态：规划（2026-10-13，未实施）。对应需求：保留网页版全部功能，废除自研插件版，
> 改用 **Auctionator** 为网页版提供数据。
> 用户已拍板：**放弃中立市场功能、放弃账本页、历史数据保留并标注口径断点**。

## 1. 背景与目标

- 现状：游戏内 **WoWderhoiAH** 插件扫描拍卖行 + 邮箱，经 SavedVariables → `watch-savedvars` 导入
  SQLite → Next.js 网页展示（行情/雷达/账本/配方利润）。
- 目标：**不再开发/维护 WoWderhoiAH 插件**，游戏内拍卖行功能全部交给 **Auctionator**
  （已装，v340 / build 624900，作者已做 Forever 适配）；网页端保留除 中立市场、账本 外的全部功能，
  数据源改为解析 Auctionator 的 SavedVariables。
- 范围外（本规划不做）：游戏内 UI 功能（出售助手、扫描按钮等）；Auctionator 的维护与升级。

## 2. Auctionator 数据能力盘点（探查结论，2026-10-13）

**落盘位置**：`C:\Program Files (x86)\World of Warcraft\_classic_beta_\WTF\Account\1120133458#1\SavedVariables\Auctionator.lua`
（该客户端把所有 SV 全局合并写入此文件；登出/`/reload` 时更新）。8 个全局变量：

| 变量 | 内容 | 能否用于网页 |
|---|---|---|
| `AUCTIONATOR_PRICE_DATABASE` | 按服务器槽分存（当前 `["PvP"]`），**CBOR 序列化字符串**（`__dbversion=8`） | ✅ 核心数据源 |
| `AUCTIONATOR_VENDOR_PRICE_CACHE` | 明文 `itemId → NPC卖价(铜)`（`__dbversion=1`） | ✅ NPC必赚雷达输入 |
| `AUCTIONATOR_SAVEDVARS` | `TimeOfLastBrowseScan`（最近扫描时间戳） | ✅ 新鲜度锚点 |
| `AUCTIONATOR_POSTING_HISTORY` | 自己的挂单记录（当前为空） | ❌ 无邮箱成交语义 |
| `AUCTIONATOR_CONFIG` / `SHOPPING_LISTS` / `RECENT_SEARCHES` / `SELLING_GROUPS` | 配置/清单 | ❌ 网页不需要 |

**价格数据库结构**（CBOR 解码后）：

```
AUCTIONATOR_PRICE_DATABASE["PvP"] = {
  ["<dbKey>"] = {
    m = <最后见到的买入最低价, 铜>,        -- 当前价锚点
    l = { ["<day>"] = 当日最低低价 },       -- 仅当低于当日最高低价时记录
    h = { ["<day>"] = 当日最高低价 },
    a = { ["<day>"] = 当日最高在售量 },
  },
  ...
}
```

- **dbKey**：普通物品 = itemId 的字符串（装备才带 `g:`/`gr:` 前缀，宠物 `p:`）；映射简单。
- **天序号**：`day = floor((time() - SCAN_DAY_0) / 86400)`，`SCAN_DAY_0 = 2020-01-01 00:00 UTC`。
- **保留窗口**：默认 21 天（`price_history_days` 配置项，用户可调）。
- **序列化机制**：当前服务器的槽在游戏内保持明文（内存），**登出时 `C_EncodingUtil.SerializeCBOR`（或 LibCBOR）写盘**；其他槽登录后延迟序列化。

**公开 API（游戏内，供其他插件）**：`RegisterForDBUpdate`（扫描完成通知，不带数据）、
`GetAuctionPriceByItemID`（最后最低价）、`GetVendorPriceByItemID`。**本规划采用纯解析方案，不依赖 API。**

**三个硬缺口（结构上没有，绕不开）**：

1. **无 P10/P50/ladder**：只有"买入最低价"按天聚合 → 市场价/7日参考/走势图整体降级为**最低价口径**；
   价位阶梯筛选（价位1比价位2低%）无数据源，**下线**；P50 展示曲线**下线**。
2. **无联盟/中立市场隔离**：只按 PvP/PvE/HC/RP 分槽，三角路口中立数据与主城混入同一 `PvP` 槽
   → 按用户决策**放弃中立功能**。
3. **无邮箱成交账本**：`POSTING_HISTORY` 只记自己的挂单（且当前为空）→ 按用户决策**放弃账本页**。

**其他影响**：
- Auctionator 价格数据库**不含物品名/品质/分类/图标** → 物品名称由 **foreverchanges.pro 数据源**
  补充（§6.5，该站持续更新：当前数据版本 1.60.1.70338、物品列表 21 页）；经典未改动物品靠现有
  `Item` 表 + wx-wow 种子兜底。
- 雷达规则（`RadarRule`）原由插件同步 → 该双向同步链路**整体下线**，雷达阈值改由网页侧管理。

## 3. 决策（用户 2026-10-13 拍板）

| 决策点 | 结论 |
|---|---|
| 中立市场（/neutral、/arbitrage） | **下线**：入口/链接移除，**代码归档保留**（git 已存，不删） |
| 成交账本（账本页） | **下线**：入口/路由移除，**代码归档保留**；另保留 POSTING_HISTORY 解析口子（§6 第 7 条） |
| 既有 P10 历史数据（~46 万行） | **保留**：留档可查，页面/图表标注"口径切换"断点；参考展示用"历史模式"开关（§12） |
| 游戏内桥接插件 | 不需要，纯解析 Auctionator SV |

## 4. 目标数据链路

```
游戏内 Auctionator（用户手动全量扫描）
   │  内存价格数据库（明文）
   ▼  登出 / /reload（PLAYER_LOGOUT 时 CBOR 序列化写盘）
Auctionator.lua（WTF SavedVariables）
   │  auctionator-watch.ts（新脚本，替代 watch-savedvars.ts）：
   │    - 解析 8 个全局（复用 src/lib/addon-scan.ts 的 parseSavedVariables）
   │    - CBOR 解码价格数据库（Node 端，cbor 库）
   │    - 天序号 → 日期（SCAN_DAY_0）
   │    - 全量幂等 upsert：最新价快照 + 每日汇总 + vendor 卖价
   ▼
SQLite（Prisma）：AuctionSnapshot / DailySummary / Item
   ▲
   │  scrape-forever-items.ts + scrape-forever-recipes.ts（手动触发，幂等，跑完报告新增数）：
   │    - 物品列表分页（/zh-cn/items，当前 21 页）→ upsert Item（名/品质/分类，补 Auctionator 缺失的名字）
   │    - 专业配方页（/zh-cn/professions/*）→ upsert Recipe（复用现有 scrape-forever-recipes.ts）
   foreverchanges.pro（数据源，持续更新）
   ▼
网页：首页 / items/[itemId] / recipes（雷达、走势、配方利润；无 P50/ladder/中立/账本）
```

**与旧链路的关键差异**：
- 没有"每轮扫描快照"概念 → 快照表退化为**每物品一行的最新状态**；走势/7日参考改由 **DailySummary** 提供。
- 没有增量游标 → 每次落盘全量解析 + 幂等 upsert（数据天然是"当前全量"）。
- 新鲜度锚点 = `TimeOfLastBrowseScan`（SV mtime 兜底），不再是扫描的 `scannedAt`。
- 雷达规则双向同步（游戏↔网页）**删除**。

## 5. 数据模型改造（prisma/schema.prisma）

### 5.1 `AuctionSnapshot`：语义改为"每物品最新价快照"

- 写入策略：`source='auctionator'`、`market='faction'`，**按 `item_id + market + source` upsert 一行**（不再每轮多行）。
- 字段映射（新数据）：
  | 列 | 来源 | 说明 |
  |---|---|---|
  | `marketPrice` | `m`（最后见最低价） | 新口径下的"市场价" |
  | `minPrice` | `m` | 同值 |
  | `quantity` | 最新日的 `a` | 在售量（Auctionator 语义=当日见过的最高量） |
  | `numAuctions` | `0` | 无挂单数数据 |
  | `altPrice` | `NULL` | P50 下线 |
  | `vendorPrice` | `Item.vendorPrice`（由 VENDOR_PRICE_CACHE 更新） | — |
  | `timestamp` | `TimeOfLastBrowseScan` 或 SV mtime | 语义="截至该时刻的价格状态" |
  | `rawPayload` | `{ m, l, h, a }` 原始块 | 调试/审计备用 |
- 索引不变；旧 `source='addon'` 行**保留不动**（断点标注依据）。

### 5.2 `DailySummary`：成为走势/7日参考的唯一来源

- 写入：按 `(itemId, date, source='auctionator')` upsert，`date = SCAN_DAY_0 + day*86400`（UTC 日）。
- 字段映射：`lowPrice = l[day]`（无 l 则 h）、`highPrice = h[day]`、`volume = a[day]`、
  `closePrice = l[day]`（口径与"最低价"一致）、`openPrice = closePrice`（Auctionator 无开盘概念）。
- 现有 med7/走势查询从 DailySummary 重算（旧数据走旧路径，source 区分）。

### 5.3 下线/停用的模型

- `RadarRule`：规则同步链路删除；表停用（不删，防误用可后续清理）。
- `TradeRecord`：账本导入/页面删除；**表与数据保留**（与"历史保留"一致）。
- `AppState`：保留（可记录 `dataSource='auctionator'`、断点日期等）。

## 6. 导入端：`scripts/auctionator-watch.ts`（新建）

替代 `watch-savedvars.ts`，监视 `Auctionator.lua`：

1. **解析**：`parseSavedVariables`（现有递归下降解析器可直接复用）读 8 个全局。
   - **M0 验证结论（2026-10-13）**：现有 `parseSavedVariables` **不能直接用于价格数据库**——
     Auctionator.lua 是"ASCII 转义文本 + 原始二进制字节"混合，必须**字节保真读取**（`readFileSync` 无编码
     → `buf.toString("latin1")`），并按 Lua 转义还原（含 `\DDD` 十进制字符码；现有解析器只处理 `\n\t` 等，
     会把 `\000` 拆错）。顶层 8 个全局、`["PvP"]` 槽提取正常。
2. **CBOR 解码**：取 `AUCTIONATOR_PRICE_DATABASE["PvP"]`（槽名 = 服务器，写死/可配置）
   → `Buffer.from(text, "latin1")` → Node `cbor` 包 `decodeFirstSync` → **Map**（键是 byte string，
   需递归转普通对象）→ `{ [dbKey]: { l, h, a, m } }`。
   - **M0 验证结论**：✅ 解码成功——**3145 个物品**（3144 有 `m`）；**标准 CBOR，兼容性风险关闭**。
   - M0 样例：`4338 魔纹布 m=3899 铜`、`2589 亚麻布 m=19 铜`（现有 DB 最近 P10≈20，吻合）、
     `4370 大型铜壳炸弹 m=200 铜`；`l` 字段多数缺失（仅当日最低<最高时记录，实际以 `h` 为主、`l` 补充）。
3. **数据落地**（每 tick 全量幂等，无需游标；仅当 `TimeOfLastBrowseScan` 或 SV mtime 变化才执行）：
   - 快照：逐物品 upsert `AuctionSnapshot`（§5.1 映射）。
   - 每日：逐物品逐日 upsert `DailySummary`（§5.2 映射）。
   - vendor：`AUCTIONATOR_VENDOR_PRICE_CACHE` 批量更新 `Item.vendorPrice`（**不回填 0**，缺=保留旧值）。
4. **物品名/品质**：仅 upsert 已存在 `Item` 的条目；新 itemId 先插入占位 `Item`（名="Item <id>"，
   品质 unknown），随后由 **foreverchanges 数据源**补齐（见 §6.5）。

## 6.5 物品/配方数据源：foreverchanges.pro（用户 2026-10-13 拍板）

**背景**：Auctionator 落盘不含物品名/品质/分类；此前项目已用该网站补过配方与物品
（`scrape-forever-recipes.ts`、`docs/archive/.tmp-items-list-1..20.html`），且网站持续更新
（物品列表 20→21 页，客户端版本 69913→70338）。用户要求：**设为物品/配方数据源**，
过段时间手动"扫一下"看新增；**所有能赚金币的东西（配方/商人兑换/材料消耗品）都覆盖**。

- **物品抓取**（新脚本 `scripts/scrape-forever-items.ts`，幂等）：
  - 抓 `/zh-cn/items` 全部分页（当前 21 页，页数从页面动态读取），解析列表 RSC payload
    （复用/参考 `docs/archive/` 的解码经验）→ 得 `itemId / 名称 / 类型 / 需要等级 / 物品等级 / 链接`；
  - upsert `Item`（name/quality 按需归一；category/sub_category 用列表"类型"或详情补充，暂无则 unknown）；
  - **不删除、不覆盖**已有名称（网页/配方种子优先），只补缺失与新增；跑完打印"新增 X、更新 Y"。
  - 注意：列表仅覆盖"Forever 新增 + 与经典不同 + 暂无数据"的物品；**经典原版物品**（亚麻布等）
    不在其中，靠现有 `Item` 表 + wx 种子兜底。
- **配方抓取**：复用 `scripts/scrape-forever-recipes.ts`（9 专业 upsert Recipe，category=craft）；
  集市商人兑换（merchant）沿用 wx 种子数据，如需网站版再核对。
- **触发方式**：用户说"扫一下"时运行（手动）；不做定时，避免频繁抓取对方站点。
  抓取节奏：全量分页间加 1–2 秒间隔；建议每周一次即可。
- **缺货标注（网页配方页）**：
  - 有 Item 记录、但拍卖行无价（Auctionator 未扫到）→ 维持现有"缺价"标记；
  - 无 Item 记录（网站也没有）→ 新增"缺记录"标记；
  - 两者在配方面板统一呈现为"缺货"状态，不参与利润计算（沿用"缺价方针"，不做补价）。
5. **日志/状态**：沿用 `logs/` + `.watch-state.json`（改为记录 `lastSeenBrowseTs` / `lastMtime`）。
6. **删除逻辑**：`syncRulesIfChanged` / `pullWebRules` / `writeRulesBackToLua` / `uploadLedger` 全部移除。
7. **账本口子（用户 2026-10-13 采纳）**：解析 `AUCTIONATOR_POSTING_HISTORY`（明文，`{__dbversion=1}`，
   当前为空）→ upsert 轻量 `PostingRecord` 表（uid/itemId/qty/unitPrice/kind/ts，按 uid 幂等）。
   不做页面；等数据积累后可按需做"我的挂单记录"页。成本≈0，为未来留路。

## 7. 查询层 / 页面适配

### 7.1 查询层（src/lib/）

| 文件 | 改动 |
|---|---|
| `repositories.ts` | "最新一轮"类查询 → 快照表全量/最新行；ladder 查询删除；`getCrossMarketSides` 删除 |
| `market-data.ts` | P10/P50/ladder 链路删除；市场价取 `marketPrice`（新口径）；走势/med7 改 DailySummary |
| `analytics.ts` | 雷达按新口径重算（见 7.3）；阶梯筛选（gap1Pct/gap2Pct）删除 |
| `recipe-profits.ts` | 材料/产出价改用新 marketPrice + vendorPrice，口径一致 |
| `market-signals.ts` / `freshness.ts` | 新鲜度锚点改 `TimeOfLastBrowseScan`/SV mtime |
| `cross-market.ts` / `market-fees.ts` | **删除** |
| `addon-scan.ts` | 保留 `parseSavedVariables`（复用）；`normalizeAddonScan` 等插件专用逻辑归档或删除 |
| `scan-import.ts` / `import-common.ts` | 改写为 auctionator 导入（或新增 `auctionator-import.ts`） |

### 7.2 页面（src/app/ + components）

- **首页**：删中立/跨市场链接、双新鲜度；市场价/7日参考口径标注"最低价"；删 P50 图例；
  加"口径切换于 <日期>"提示。
- **单品页**：走势图改 DailySummary 日线（单线，最低价口径）；删 P50 曲线；K线/季节沿用（数据源变）。
- **雷达**：保留 全部品类/仅限高流通商品/价格下限；**删 价位阶梯两个筛选**；
  "必赚最低盈利"等阈值改网页侧配置。
- **删除**：`/neutral`、`/arbitrage`、`/ledger`（及 `clear-ledger-button`、账本组件、`watch-star` 相关若仅服务于中立/账本则保留）。

### 7.3 雷达口径（新定义，实施时与用户确认）

- **NPC必赚**：`Item.vendorPrice > marketPrice`（数据源更全，逻辑不变）。
- **捡漏**：建议改为"最后最低价 `m` ≤ 近 7 日 DailySummary 均值的 (1-X%)"（相对自身历史，抗单一钓单不如 P10，
  但可用在售量门槛过滤）。具体阈值沿用现有默认值，页面可调。
- **高流通**：用 `a`（在售量）或 DailySummary.volume。

### 7.4 断点标注

- 依据 `source` 列（`addon`=P10 旧口径，`auctionator`=最低价新口径）区分；
- 图表跨断点处画竖线 + 文案；页头显示"数据口径于 <公测/切换日> 起为 Auctionator 最低价"。

## 8. 下线清单（一次性清理）

1. 游戏内：`WoWderhoiAH` 插件目录从 AddOns 移除（仓库 `addon/WoWderhoiAH/` 保留，可随时恢复；
   符合"代码保留"偏好）；SV 文件 `WoWderhoiAH*.lua` 按"公测清空"节奏处理。
2. 服务：停 `watch-savedvars`（进程），改启 `auctionator-watch`（Program Files node，见 HANDOFF §4 惯例）。
3. 代码：上述页面/组件/库/脚本删除项；`scripts/gen-lua-rules.ts` 等插件配套脚本归档。
4. 部署/校验脚本：哈希比对等插件部署逻辑移除或归档。

## 9. 已知限制（如实告知）

- **口径变化**：市场价/7日参考/走势从 P10 加权分位 → 最低买入价。最低价易被低价钓单拉低，
  捡漏信号可能增多假阳性（用阈值+在售量缓解）。
- **新物品名缺失**：Auctionator 落盘无名称/品质/分类 → 由 foreverchanges.pro 数据源补齐
  （Forever 新增/改动物品全覆盖）；经典未改动物品靠现有 `Item` 表 + wx 种子兜底；
  两边都没有的极少数显示占位名。
- **新鲜度依赖用户扫描频率**：需在游戏内手动触发 Auctionator 全量扫描，然后**登出或 /reload**
  才落盘；不扫描则网页不更新（机制与现在相同）。
- **21 天历史窗口**：走势/7日参考最长 21 天（Auctionator 配置可调大）。
- **中立数据废弃**：若日后重启中立市场，需引入游戏内分流（超出本规划范围）。

## 10. 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| CBOR 解码与 Forever 客户端序列化不兼容 | ✅ 已关闭 | M0 已用真实 SV 样本验证：标准 CBOR，`cbor` 包可直接解码（3145 物品） |
| 口径切换后雷达/价格展示语义漂移 | 中 | 断点标注 + 页内口径说明 + 阈值网页可调 |
| 物品名缺失导致页面观感差 | 中 | foreverchanges 数据源补名（§6.5）+ 现有 Item 表/wx 种子兜底 + 占位名 |
| 网站改版导致抓取失效 | 低 | 抓取脚本集中解析函数，改版时按存档样例（docs/archive/.tmp-*）修正则即可 |
| 新导入与旧查询代码纠缠 | 中 | source 列严格区分，查询按 source 分支，逐步清理 |

## 11. 里程碑

| 里程碑 | 内容 | 验收 |
|---|---|---|
| **M0 PoC**（先行） | Node 端解码真实 `Auctionator.lua` 价格数据库（CBOR + 天序号换算），输出 ≥20 物品价格 | 与游戏内 Auctionator 显示一致 |
| **M1 数据层** ✅ | `src/lib/auctionator-sv.ts`（共享解码库）+ `scripts/auctionator-import.ts`（先删后插，幂等）+ schema 加 `PostingRecord` | ✅ 3144 快照 + 3621 每日入库、重复导入幂等、typecheck 绿、旧 addon 数据未动 |
| **M1b 网站数据源** | 新 `scrape-forever-items.ts`（物品列表分页→Item）+ 复用 `scrape-forever-recipes.ts`（配方）；配方页"缺价/缺记录"标注 | 幂等重跑报告新增数；物品名覆盖提升；配方缺货标注正确 |
| **M2 页面适配** ✅ | 查询层/雷达/首页/单品页/配方改口径；下线功能归档 | ✅ 页面 HTTP 200、口径正确、无 P50/ladder/中立/账本残留、123 测试 + typecheck + build 全绿 |
| **M3 收尾** | 断点标注；vitest/tsc 全绿；停旧服务启新服务；HANDOFF 更新；插件目录移除 | 全量测试通过、网页可用、文档同步 |

> 切换时机可与"公测清空运行时数据"联动：公测前完成 M0–M2 并用旧数据联调，公测清空时旧数据一并清掉。

## 12. 待确认/待办小项

- [ ] **后话（用户 2026-10-13，实现按"历史模式"开关）**：现有数据均为"无限删档测试 Beta"产物，
      开服（公测）后重新统计；但**老数据的历史 P10 曲线必须保留**。实现（采纳建议 2，不做独立临时站）：
      ① 切换/清空前把 `source='addon'` 的 AuctionSnapshot（P10）归档到**独立文件**（`prisma/archive-p10.db`），
      不污染新库查询；② 现有页面加"历史模式"开关——单品页走势图可切到 P10 历史口径、首页给查看入口，
      复用现有组件；③ 开服稳定后隐藏入口（代码留 git）。与"公测清空"偏好（p1_AQFJGcEGWaE）联动：
      主库照清、归档例外。
- [x] **M0（2026-10-13 完成）**：CBOR 解码验证通过——标准 CBOR、`cbor` 包可解、3145 物品、
      天序号换算自洽（SCAN_DAY_0=2020-01-01 本地时区，day 2477=今日）、价格与现有 DB P10 交叉吻合。
      产物：`scripts/auctionator-m0-decode.ts`（含字节保真读取 + Lua 转义解码 + Map 转换，导入端复用）。
- [x] 雷达"捡漏"新口径（M2 实施）：最低买入价 ≤ 7日参考 × 0.85，30c/25% 利润门、
      3 天历史 + 参考可信度门；**挂单数流动性门删除**（Auctionator 无挂单数，
      用户选择先观察、不加替代门槛）。阈值 = 网页侧常量（插件下线后无游戏内面板）。
- [x] `TimeOfLastBrowseScan` 快照时间 = 最新 Auctionator 扫描时间（10-07）；新鲜度
      窗口放宽到 **7 天**（`AUCTIONATOR_STALE_MAX_AGE_MS`），超过 7 天未扫描才 stale。
- [x] **VENDOR_PRICE_CACHE 单位已确认（M1）**：**银**（经典 `GetMerchantItemPrice` 返回银，`CraftingInfo` 里
      `price/stack` 得小数）→ 导入时 ×100 转铜，与现有 `Item.vendorPrice` 语义一致。
- [ ] POSTING_HISTORY 真实结构待版本适配（当前 `{__dbversion=1}` 空；等游戏内挂单积累后再补映射，表已建）。
- [ ] 跑一次 `scrape-forever-items.ts` 初始化物品名覆盖（用户说"扫一下"时再跑增量）。
- [x] 配方面板"缺货"标注（M2 已做）：`status="missing"` 显示"缺货 · 缺 X"，替代旧"缺价"。
- [ ] Auctionator 槽名（`PvP`）是否随服务器变化——写配置，不硬编码。
- [ ] 首页全量查询 7.5s 偏慢（market-signals 有内存缓存，首跳后正常）；如需优化可在
      M3 把 med7 聚合改为按需查询。
