# AH 项目跟进文件（HANDOFF · v3）

> **进入本项目的唯一必读入口**：先读本文件，再按需精读具体代码，不要通读整个仓库。
> 最后更新：2026-10-14（本地 UTC+2）。对应 git HEAD：本版随"雷达门槛精简 + vendor 全量核对"提交推送。
> **v2/v3 说明**：2026-10-13 起数据源已从自研插件切换为 Auctionator + M4 转录插件；旧自研插件
> 时代的一切历史记录（P10/P50、中立市场、账本、旧扫描链路等）**已全部失效**，本版不再保留。
> v3 新增：雷达门槛最终口径（用户拍板）、网页设置面板（含价格下限）、vendor 价全量核对机制。
> v3.1（2026-10-14 晚）：转录插件升 0.2.0——① 商人价实时转录（WAHVendorDB，NPC 收购价用
> `C_Item.GetItemInfo` 第 11 返回 sellPrice，**不是** Auctionator 缓存那套买价÷组数）＋
> ② Auctionator 全量扫描完成自动 /reload 落盘（`/wahvendor reload` 控制）＋ ③
> `scripts/vendor-game-import.ts` 导入游戏内实时价（优先于网站核对）；audit 启动时跳过已有
> 游戏内值的物品。
> 语言：与用户用中文交流；代码/标识符保持英文。

## 1. 项目是什么

WoW Forever 私服（客户端 1.60.1，`C:\Program Files (x86)\World of Warcraft\_classic_beta_\`）拍卖行
行情**网页终端**（Next.js 本地单机）。数据来自游戏内插件的 SavedVariables 落盘 → 本地 Node 脚本
导入 SQLite → 网页展示行情、捡漏雷达、配方利润、历史 P10 参考。

技术栈：Next.js App Router + Tailwind；Prisma + SQLite；Node + tsx（一次性导入脚本）；vitest 测试。
仓库：`origin=https://github.com/Huiscode/Ah.git`，分支 main。项目根：`C:\Users\Hz\Documents\Workspace\Ah`。

## 2. 数据源与数据链路（核心）

**四种数据源并存，靠 `source` 列区分**：

| source | 内容 | 角色 |
|---|---|---|
| `transcript` | M4 转录插件，**完整价格档位**（暴雪官方 API 实测） | **档位主源**：当前价/在售量 = 最新轮经 tier-filter 的有效最低价 |
| `auctionator` | Auctionator 存档，**仅聚合价**（m/l/h/a + 7 日 daily） | transcript 缺失时的回退 + 历史参照 |
| `addon` | 旧自研插件 Beta 删档数据（47 万行 P10，截至 10-06） | **仅历史模式**（`?history=1`） |
| foreverchanges.pro | 物品/配方/NPC 卖价的**游戏内确认权威**（网站） | **vendor 价唯一权威**（v3 全量核对中）；物品名、配方（M1b 待正式抓取） |

```
游戏内 Auctionator（扫描 → 聚合价 m/l/h/a 落盘）
   │  登出 / /reload 才写盘 → Auctionator.lua
   ▼
npm run auctionator:import        # 解码（ASCII 转义+CBOR）→ 快照 + DailySummary（source='auctionator'）
                                  # 不再写 Item.vendorPrice（VENDOR_PRICE_CACHE 失真，见 §5-7）

游戏内 WoWderhoiAH-Transcript（/wahscan start，逐物品 SendSearchQuery 读完整档位）
   │  登出 / /reload 落盘 → WoWderhoiAH-Transcript.lua（WAHTranscribeDB + State）
   ▼
npm run transcript:import         # fengari 执行存档 → AuctionTier（完整档位）+ tier-filter 聚合 DailySummary
                                  # 断点续扫存在 WAHTranscribeState（首轮实际不可续，见 §5-3）

游戏内 WoWderhoiAH-Transcript（打开商人窗口自动记录 → WAHVendorDB，v0.2.0）
   │  Auctionator 全量扫描完成自动 /reload 落盘（v0.2.0 AutoReload.lua）
   ▼
npm run vendor:import              # scripts/vendor-game-import.ts：游戏内实时商人价 → Item.vendorPrice
                                  # （权威顺序：游戏内实时 > 网站核对 > 旧缓存；audit 跳过已有 game 值）

SQLite（prisma\dev.db）→ 网页（首页 / 单品页 / 配方页；两模式互不混源）
```

**关键机制**：网页只能看到已落盘数据。游戏内扫完要立刻同步 → `/reload` 或登出 → 重跑两个导入脚本。
页面模式：当前（默认，transcript→auctionator，**排除 addon**）与历史（`?history=1`，只看 addon P10）。

## 3. 关键路径速查

| 用途 | 路径 |
|---|---|
| 项目根 / 数据库 | `C:\Users\Hz\Documents\Workspace\Ah` / **`prisma\dev.db`**（根目录 `dev.db` 是 0 字节陷阱） |
| Auctionator 插件（游戏内） | `...\_classic_beta_\Interface\AddOns\Auctionator\` |
| Auctionator SV（聚合价源） | `...\WTF\Account\1120133458#1\SavedVariables\Auctionator.lua`（槽 `PvP`） |
| 转录插件（游戏内） | `...\Interface\AddOns\WoWderhoiAH-Transcript\`（仓库副本 `addon-transcript\`，v0.2.0：Transcript.lua + VendorPrice.lua + AutoReload.lua） |
| 转录存档（档位源） | `...\SavedVariables\WoWderhoiAH-Transcript.lua`（按插件名落盘；含 WAHTranscribeDB / State / **WAHVendorDB** / WAHReloadOpts） |
| 旧插件归档（勿恢复） | `archive\addon\WoWderhoiAH\`、下线功能 `archive\` |
| 导入脚本 | `scripts\auctionator-import.ts`（`npm run auctionator:import`）、`scripts\transcript-import.ts`（`npm run transcript:import`）、`scripts\vendor-game-import.ts`（`npm run vendor:import`，游戏内实时商人价）、**`scripts\watch-auto-import.ts`（`npm run watch`，常驻自动导入：扫描完成自动同步网页，唯一同步入口）** |
| **vendor 全量核对** | `scripts\vendor-price-audit.ts`（后台/手动跑；断点续跑；限速防 403；**启动时跳过已有游戏内实时价的物品**） |
| 游戏内商人价解析 | `src\lib\vendor-sv.ts`（loadVendorGamePrices / transcriptSvPath，fengari 解析 WAHVendorDB） |
| 共享解码 | `src\lib\auctionator-sv.ts`（readAuctionatorSavedVars / CBOR / Lua 转义） |
| 一键启停 | `WAH一键启动.bat` / `WAH一键停止.bat` → `scripts\launch-services.ps1`（网页 + 常驻自动导入；停止 bat 按 `watch-auto-import` 匹配） |
| 档位过滤公式 | `src\lib\tier-filter.ts`（13 测试） |
| 极少挂单剔除 | `src\lib\bait-filter.ts`（markBaitDays / markThinDays） |
| 查询层 / 信号 / 雷达 | `src\lib\repositories.ts`（mode 分叉）、`analytics.ts`、`market-signals.ts`（快照代+mode 缓存）、`market-rules.ts`（雷达阈值） |
| **雷达设置（网页）** | `src\app\api\radar-rules\route.ts`（GET/POST 读写 RadarRule 单行 id=1）、`src\components\radar-settings-button.tsx`（设置面板）、`deal-radar-table.tsx`（雷达表，表头已去价格下限） |
| 迁移计划（唯一权威） | `docs\plans\auctionator-migration-plan.md` |
| 环境变量（导入用） | `AQ_AUCTIONATOR_SV_PATH`、`AQ_AUCTIONATOR_REALM_SLOT="PvP"`、`AQ_SERVER="Classic Beta PvP 2"`、`AQ_FACTION="Alliance"`；`.env` 里 `DATABASE_URL=file:./dev.db` |

## 4. 关键口径与算法（用户拍板，勿擅改）

- **当前价 = 最低买入价**（Auctionator 无 P10/P50/ladder；transcript 有档位时用**有效最低价**）。
- **档位过滤（路线 A，tier-filter）**：按升序档位分组（组内与下一档价差 < gapRatio=1.3）；
  遇断层且"组累计 < 下一档数量 × cumRatio=0.5" → **整组剔除**（钓单防护）；否则取组内最低档为有效价；
  总档数 < minTotal=3 不过滤（低流通保底）。**极低价绝不剔 = 捡漏机会**；只有"极少挂单的极高价"才从
  走势剔除。
- **7 日参考（med7）**：近 7 日 DailySummary 收盘中位数；**剔除一切"极少挂单日"，不论价高低**
  （markThinDays：minSamples=5 / volumeRatio=0.2 / highPriceRatio=2）。
- **走势图**：收盘单线（每日一价）；只剔"极少挂单 + 极高价"日（markBaitDays）。
- **雷达（2026-10-14 用户拍板最终口径，v3）**：
  - `必赚` = 当前最低买入价 < NPC 卖价（**不需要历史、无任何门槛**；只受 vendor 价准确性影响）。
  - `捡漏` 条件（全部网页设置面板可调，存 `RadarRule` 单行）：
    **最低盈利 ≥ 50 铜**（净利 = med7×0.95 − minPrice）、**最少历史 ≥ 2 天**、
    **参考可信度 ≥ 2 个不同收盘价**、**新鲜度窗口 7 天**（可改 1 天）。
  - **已移除门槛**（用户逐项拍板删除）：折扣线（discount）、折扣下限（maxDiscount）、供应上限
    （supplyCap）、最低利润率（minProfitRatio）——**深折扣一律视为捡漏机会**，不按折扣深浅设限。
  - **价格下限** = 前端本地筛选（localStorage `wah:filter:minPrice`），已移入设置面板，与雷达门槛
    同屏保存；0 = 关。
- **vendor（NPC 卖价）权威顺序（2026-10-14 拍板，v3.1）**：**游戏内实时商人价（WAHVendorDB，
  `C_Item.GetItemInfo` 第 11 返回 sellPrice，服务器下发最准）> foreverchanges.pro 物品页"卖价"
  实测 > Auctionator 缓存（已弃用）**。页面无"卖价"字段 = NPC 不收 → 置 0。游戏内值由
  `npm run vendor:import` 导入并覆盖 Item.vendorPrice；audit 启动时跳过已有游戏内值的物品。
- **配方利润兜底双 floor（2026-10-14 拍板，v3.2 / M4.2）**：`buildRecipeFloors` 返回
  `{ costFloor, revenueFloor }`（替代旧 `buildFloorPriceIndex` 单 map）：
  - **costFloor（材料成本兜底）= Item.sellPrice（NPC 卖价，游戏内商人卖出单价，`GetMerchantItemInfo`
    的 price÷quantity）> 收购价（Item.vendorPrice/字典）> 配方 dump**。材料无 AH 价时按 NPC 卖价算
    成本——用收购价兜底会低估成本、虚高利润。
  - **revenueFloor（成品收入兜底）= 收购价（卖 NPC 的保底收入）**。
  - 数据来源：VendorPrice.lua v0.2.1 同格记录 `sp = price÷quantity`（与 `p` 分开，勿混），
    WAHVendorDB.scans[id] = { p, sp, t }；vendor-game-import 导入 `sp → Item.sellPrice`（新列，
    db push 于 2026-10-14 晚）；`getItemSellerPrices(ByIds)` 供三个页面。数据未到位时 sp=0，
    自动退化为收购价兜底（行为同旧版，不阻塞）。
- **历史模式**：`?history=1` 看旧 Beta P10（addon），用于开服后参考老曲线；两模式查询/页面互不混源。
- **口径断点 = 2026-10-13**（页头标注）。

## 5. 实测期发现并修复的问题（M4 上线至今）

1. **toc Interface 不匹配**：`## Interface: 120000` 与客户端 16001 不匹配 → 插件不加载。
   改为 `16001, 120100, 120000, 50504, 38000, 20506, 11508, 11509`（仓库 + 游戏目录同步）。
2. **物品清单取错**：`collectItemIds` 直接遍历 `AUCTIONATOR_PRICE_DATABASE` 顶层拿到的是**槽名**
   （真实结构 `{["PvP"]={[itemId]={…}}}`）→ 先取 `db.PvP` 槽再合并其余槽；完整扫描后
   `/wahscan start` 曾报"未找到物品清单"，修复后成功启动 3577 物品约 36 分钟。
3. **首轮扫描中断不可续**：实际只完成 48 物品/254 档位，`WAHTranscribeState` 队列被清空
   （queue={}, done=0）→ 只能重新 `start` 全扫。48 条已导入（source 干净）。
4. **雷达空**：`getLatestRoundItemIds` transcript 独占 → 改 **transcript ∪ auctionator 并集**；
   `buildDealRadar` 默认 2 小时新鲜度误判手扫数据过期 → 显式 7 天（`AUCTIONATOR_STALE_MAX_AGE_MS`）。
5. **source 隔离**：`buildMarketSignal` 不按模式过滤快照源 → 当前模式混入 addon 老数据（如草莓汁
   10-06 价被当"当前价"推进必赚）→ 改为 history 只用 addon、current 排除 addon；查询层
   getMarketUniverse / getItemDetail / med7 SQL 均排除 addon。
6. **med7 虚标**：getMed7Aggregates 按"最新 daily 选源"把 addon 10-09 行误选为参考源（墨水 7 日参考
   虚标 74 铜）→ SQL 排除 addon，只算真实源。
7. **VENDOR_PRICE_CACHE 失真（墨水 20 金事件）**：DB 墨水 vendor=200000 铜（20 金）→ 用户质疑 → 与
   foreverchanges 交叉验证：墨水真 5 银、树干 5 银、星木 11 银 25 铜、结构图 30 银、粗原木 5 金，
   **全部与缓存不符**（缓存普遍 = 真实铜价 ×4 上下，倍数因物品而异）。源码确认该缓存是**玩家打开
   NPC 商人时** `GetMerchantItemInfo` 总价 ÷ 组数量的实测记录（CraftingInfo 制造利润模块用），
   Forever 私服该 API 语义与官方不同 → 系统性失真。**修复**：① 必赚区 72 个物品 vendorPrice 用
   foreverchanges 实测价覆盖（必赚 89 → 23）；② `auctionator-import.ts` 弃用 VENDOR_PRICE_CACHE。
8. **捡漏 411 → 0 是正确行为**：addon 隔离后捡漏只看 Auctionator 真实数据，而多数物品只有 1 天历史
   （1天 2768 / 2天 435 / 3天 2）→ 3 天门槛挡住。**连续扫几天后自然充实**。
9. **【v3】vendor 价全量核对（苹果 1 铜事件）**：用户发现"新鲜的红苹果"DB vendor=460 铜、真实卖价
   1 铜（失真 460 倍）→ 排查发现 **Item 表 3481 条 vendor_price>0 几乎全是旧缓存失真值**（上次只修
   了必赚区 72 条）。**处理**：① 必赚区 23 条逐一抓 foreverchanges 实测——修正 6 条（苹果 460→1、
   剥皮小刀 900→16、矿工锄 900→16、奶酪 500→1、硬肉干 500→1、面包 500→1）、置 0 四条（小飞刀、
   重弹丸、箭×2——**弹药/箭矢类 NPC 不收**，页面无卖价字段）；**必赚 23 → 13**。② 全量核对脚本
   `scripts\vendor-price-audit.ts`（后台）：遍历全部 vendor_price>0 物品，以 foreverchanges"卖价"为
   唯一权威，页面无卖价 → 置 0；**断点续跑**（进度文件 `scripts/.vendor-audit-progress.json`，已
   gitignore）、限速 2.5s/条 + 403 退避 15s×3。约 3400 条 ≈ 2.5 小时。
10. **【v3】雷达门槛精简 + 设置面板**：`DealRadarRules` 移除 maxDiscount/supplyCap/discount/
    minProfitRatio，默认 50 铜/2 天/2 可信度/7 天新鲜度；新增 `/api/radar-rules`（GET 合并默认+DB
    覆盖，POST 校验写 RadarRule id=1）与设置面板（雷达门槛 4 项 + **价格下限**，表头价格下限输入
    已移除）；**鼠标移出面板自动关闭**。面板保存 = 门槛 POST + 价格下限写 localStorage 并广播
    storage 事件（雷达表 `usePersistedState` 同 key 即时应用）。
11. **【v3】折扣%口径**：`buildMarketSignal.discountPercent` 原用 `latest.marketPrice`，语义应基于
    **可买的最低价** `latest.minPrice`（生产上二者恰相等未暴露）→ 已修正并测试钉死。
12. **【v3.1】游戏内商人价实时转录 + 全量扫描自动落盘**：用户要求保留游戏内商人价核对（实时读到的
    最准）。根因确认：Auctionator 的 AUCTIONATOR_VENDOR_PRICE_CACHE 用 `GetMerchantItemInfo` 的
    **买价**（第 3 返回 price）÷ 组数当卖价——语义就错（旧插件注释与 CraftingInfo\Main.lua 14-23
    行一致）；正解 = `C_Item.GetItemInfo(itemId)` 第 11 返回 sellPrice（旧插件 Trade.lua 已用此法）。
    实现：VendorPrice.lua 监听 MERCHANT_SHOW/UPDATE 自动转录 WAHVendorDB；AutoReload.lua 挂
    Auctionator.EventBus 的 FullScan.ScanComplete（`RegisterForDBUpdate` 的 PricesProcessed 会误触发，
    故直接挂 ScanComplete），扫描完成延迟 **2 秒**（默认，`/wahvendor reload delay N` 可调）自动
    /reload 落盘（`/wahvendor reload on|off|now|status`，战斗保护）；`npm run vendor:import`
    导入覆盖 Item.vendorPrice；audit 跳过已有 game 值的物品。
13. **【v3.1】AutoReload 双保险**：用户实测"扫描完没有自动 reload"（游戏内还跑旧版文件导致）。
    加固：① 保留 EventBus:Register；② 新增兜底 hook `Auctionator.EventBus:Fire`（事件名匹配
    `get_all_scan_complete`，不依赖自身 listener 注册）；③ schedule 10 秒防重；④ 加载成功打印
    "自动重载已就绪"。**插件文件更新后必须 /reload 或完全退出游戏才生效**（toc 变更尤其）。
14. **【v3.1】audit 双实例事故 + watch 常驻自动导入**：发现两个 vendor-price-audit 实例并发跑
    （进度文件互相覆盖、重复抓取、403 风险、且跑的是旧代码）→ 全部停掉，用新代码重启**单实例**
    后台续跑（断点续跑，进度文件 scripts/.vendor-audit-progress.json，当时 2488/3454）。
    新增 `scripts/watch-auto-import.ts`（`npm run watch`）：**常驻自动导入**（等价老插件
    addon:watch 体验：每 2 秒 stat 存档 mtime，扫描完成自动导入、不退出）。用户后续拍板：
    **单次/短命 sync 模式已删除，只保留全自动**（`npm run watch` 为唯一同步入口；旧的悬空
    `addon:watch` 脚本一并清理）。导入顺序 = auctionator:import + transcript:import +
    vendor:import（vendor 无游戏内数据自动跳过；导入失败不崩、继续监视）。
15. **【v3.2 / M4.2】配方材料成本兜底口径修正**：配方利润引擎把材料成本兜底从"收购价"升级为
    "NPC 卖价优先"（详见 §4）。**foreverchanges 物品页实测无"售价"字段**（只有"卖价"收购价），
    NPC 卖价唯一可靠来源 = 游戏内商人窗口 `GetMerchantItemInfo(i)` 的 price÷quantity（单价）。
    实现：VendorPrice.lua v0.2.1 同格记录 sp；Item 表新增 sell_price 列（db push 已应用）；
    vendor-game-import 导入 sp；recipe-profits 拆 costFloor/revenueFloor；secondary-materials 与
    三个页面（recipes/首页/物品详情）同步适配；测试新增"成本兜底优先 NPC 卖价"用例（154 全过）。
16. **【v3.2 / M1b】配方+物品全量抓取启动**：audit 已全部完成（3454 条：有效 878、置 0 83、
    失败 28 条 404 页不存在）。M1b 脚本 `scripts/m1b-forever-library.ts` 后台运行：阶段 1 抓
    9 个专业页核对配方（246 配方，附魔=效果配方无物品产出不收录、钓鱼=纯指南页无数据，均正确）；
    阶段 2 抓 Recipe 全部材料+产出物品页（2696 个，限速 2.5s/条 ≈ 1.9h，断点续跑
    scripts/.m1b-progress.json）补 name/quality/category/subCategory/vendorPrice（含 196 个
    "Item N"占位名）。完成后跑 compute-turnover 刷新流通分。
17. **【v3.2】新鲜度锚点误报"1 天前"**：用户扫描 reload 后网页仍显示"数据更新于 1 天前"。
    根因：M4 时新鲜度锚点只取 transcript 档位（AuctionTier.ts，当时是唯一最新数据源）；用户改用
    Auctionator 扫描后 transcript 停更（档位最新 = 10-13），锚点被钉在旧档位 → 误报。
    修复：`getLatestSnapshotTime` current 模式改取 **transcript 档位 与 Auctionator 快照的较新者**
    （history 模式仍只看 addon）。连带发现环境问题：① 网页跑在生产模式旧 build（`next start`
    PID 3700，19:49 构建，不含新代码）→ 停掉改由一键启动（`next dev --webpack` 热更新）接管；
    ② watch 常驻导入没在跑（21:55 曾导入一次后进程消失）→ 一键启动重新拉起，并立即检测到
    用户新扫描存档自动导入（3703 快照，TimeOfLastBrowseScan=2026-10-14T20:37:26Z）。
    验证：首页标签恢复"6 分钟前"。
18. **【v3.3】AH 行情残留旧价（墨水 1 金假价）**：用户"刚扫了最新仍很多价格不对"。根因：物品
    本次扫描无在售时，Auctionator 保留"最后见到买入价" m 不更新，导入脚本把它当今天的价
    （墨水 10-08 后无货却显示 1 金，其材料成本带歪配方利润）。**修复**：auctionator-import.ts
    增加 `latestSeenDayOf(entries)`（价格库最大 day 桶）+ `quantityOnDay`；**本次扫描日无在售
    的快照写 price=0**，num_auctions 顺带修复（原恒 0，现=当日真实在售量）；market-signals.ts
    缓存信号 `.filter(signal.price > 0)`（0 价=缺货，不进市场/雷达/配方）。重跑导入：3767 快照、
    **658 个无货物品归零**。验证：墨水 0 在售不再显示、强效魔法杖 3银/195 等真实价保留。
19. **【v3.3】vendor 价取错版本（经典 vs 无限服）**：用户截图铁证——foreverchanges 物品页
    **并排展示 CLASSIC ERA（经典旧世）与 FOREVER BETA（无限服）两版属性**，差异行分别标
    `it-del`（经典独有）/`it-add`（无限服新增/修改）。用户玩无限服，**正确收购价 = it-add 行
    卖价**；原抓取（m1b parseItem + vendor-price-audit parseSellPrice）匹配页面**第一个"卖价"
    = 经典版**，凡无限服改过收购价的物品全错（例：强效魔法杖 经典 15银35铜 vs 无限服 2银，
    "必赚"面板误报 +12银35铜）。**修复**：两个解析函数改为优先匹配
    `class="it-line...it-add...">卖价` 行，无差异回退普通卖价；新增 `scripts/fix-vendor-forever.ts`
    全量重核（Item 5,689 条，M1B_INTERVAL_MS=0 快跑约 15 分钟，断点
    scripts/.vendor-forever-fix-progress.json）：更新 5,376、无卖价 276、404 失败 37（网站不存在的
    占位物品）。**抽查修正**：强效魔法杖 1535→200、次级魔法杖 508→110、初级巫师之油 500→100
    （公式 20758 两版同为 125、奥术防护之医疗法杖 4575 两版同为 1487——两者本就正确，真必赚
    保留）。metaVersion=Item MAX(updatedAt) → 缓存自动失效，网页无需手动清。**影响面无法
    回溯精确旧错误条数**（重核为覆盖写），但全库 5,376 条 vendor_price>0 现均以无限服版为准
    （另有 28 个网站 404 物品已按 §5-20 清 0）。
20. **【v3.3】"网站搜不到却显示价"两类物品澄清**：① **随机前缀物品**（"孤狼之轻身法杖"等，
    DB 843 个含"之"）：网站**有数据**——按基础名收录（3185="轻身法杖"，卖价 80银88铜与 DB
    一致），前缀是游戏内怪物掉落随机生成，网站搜索搜前缀名才 0 结果；AH 真实在售（3185 今
    日 36 挂单 80银），"必赚 +88" 为真。② **网站真 404 却留脏 vendor 价：28 个**（卷轴彩蛋名、
    唤魔者披肩/束带、白银之手作训锤、强效秘法杖、霜爆术卷轴等，audit/M1b 404 时跳过未清，
    保留 Auctionator 缓存时代失真值）→ **已全部置 0**（无权威来源按 NPC 不收）；fix-vendor-forever.ts
    同步改进：404 时置 0 而非跳过，后续重跑自动清理。验证：必赚列表不再含 28 个，配方库仍
    保留其配方记录（仅材料/图样引用，非行情）。

## 6. 数据现状（2026-10-14）

- AuctionSnapshot：addon 473,663 / auctionator 3,519~3,520
- DailySummary：addon 47,606 / auctionator 6,771 / transcript 48（10-14 首轮 1 天）
- AuctionTier：transcript 254 档 / 48 物品（首轮，未覆盖全量）
- Item：5,689（+177 新行：Recipe 材料/产出此前库外物品）；当前信号 3,521（无 addon）
- vendor_price>0：**全量核对已完成**（3454 条：有效 878、置 0 83、404 失败 28）；现 **5,376 条，
  全部以 foreverchanges 无限服（FOREVER BETA it-add 版）卖价为准**（v3.3 重核，见 §5-19；
  另 28 个网站 404 物品脏价已清 0，见 §5-20）
- **配方库**：Recipe 2,265 行（来源=foreverchanges.pro 核对 + 种子配方）；**M1b 已完成**
  （10-15 用户拍板不限速，M1B_INTERVAL_MS=0，4 分钟跑完 1708 条：更新 1695、404 13）；
  占位名剩余 235（网站自身未收录，404/网站 h1 即 "Item N"，不影响价格与利润）；
  compute-turnover 已跑：532 材料流通分刷新（Top：无瑕皮革 247、硬甲皮 183、符文布卷 158）
- 雷达（当前设置：最低盈利 50 铜 / 历史 2 天 / 可信度 2 / 新鲜度 1 天，用户自调）：**36 条 =
  必赚 13 + 捡漏 23**；捡漏随新鲜度窗口与数据积累波动

## 7. 待办 / 未完成（按优先级）

1. **配方库页"缺货/缺名"复核**：M1b 已完成（10-15），可对照网页看缺货配方是否减少；
   剩余 235 个"Item N"占位名为网站未收录（保留即可，不影响计算）。
2. **转录全量重扫**（M4 落地关键）：用户游戏内开拍卖行 → `/wahscan start` → 登出 →
   `npm run transcript:import`（先删后插）。用户现已改走 Auctionator 全量扫描 + 自动重载 +
   watch 常驻导入，转录可选。
3. **游戏内商人价 sp 数据积累**：插件 v0.2.1 需用户 /reload 加载；打开商人窗口自动记录
   （收购价+卖出单价）；watch 导入 sp 后配方材料成本兜底自动生效。
4. **POSTING_HISTORY**：当前为空（`{__dbversion=1}`），`PostingRecord` 表已建、解析口子就绪。
5. **网页必赚列表加"Auctionator 搜索词"列 + 一键复制购物清单**（用户 2026-10-15 需求：
   "快速找到并拍下"）：显示每件物品的基础名（去随机前缀）+ 物品 ID；搜索词统一用基础名
   （如"轻身法杖"而非"孤狼之轻身法杖"，一次命中全部前缀变体）；复制按钮生成可贴进
   Auctionator 购物清单的文本。**未实现**。
6. **开服清空运行时数据**（SQLite + SavedVariables + 导入进度；代码/git 保留），由用户通知触发。

## 8. git 状态

- HEAD = origin/main = **M4h**（b05b66e）：AH 残留旧价归零 + vendor 无限服版全量重核 + 404 脏价
  清理 + 前缀物品澄清（v3.3 修复批次）。
- 纪律：**只有用户明确说"推/推一版"才 push；说"提交git"才 commit**；只提交点名范围。

## 9. 已知坑 / 机制限制

- **SV 落盘时机**：登出 / /reload 才写盘；游戏内扫完必须 /reload 或登出再导入。
- **Auctionator.lua 解码三坑**（`auctionator-sv.ts` 已处理）：ASCII 转义 + 原始二进制混合 → 字节保真
  读（latin1）；Lua `\DDD` 十进制转义；CBOR byte-string 键 → Map 递归转对象。
- **Auctionator 无 P10/ladder/挂单数**：当前口径 = 最低买入价 m；档位只有 transcript 有。
- **foreverchanges.pro 限流**：批量抓取 403 → 必须限速（间隔 2.5s+）+ 退避重试；列表页也被反爬
  （无批量接口），只能逐条抓物品页；`vendor-price-audit.ts` 已内置全部策略。
- **Prisma DLL 锁冲突**：后台 audit 占用 query_engine DLL 时 `npm run build` 的 prisma generate 会
  EPERM → 先停 audit 再 build，build 完再续跑（断点续跑无损）。
- **TimeOfLastBrowseScan = "浏览"时间非全量扫描时间**：以 SV mtime / 快照 MAX(timestamp) 为准。
- **fengari 解析 Lua 存档**：需 `to_luastring`、`lua_next` 迭代体内不可递归、按 key 的 Lua 类型区分
  数组/记录（字符串 "2589" 与数字 2589 是不同键）。
- **Prisma `$queryRaw` 的 Json 列返回已反序列化对象**，不要再 JSON.parse。
- **Next 增量构建偶发旧 chunk 残留**（症状：单页 500 而源码/直调正常）→ `Remove-Item .next -Recurse
  -Force` 后 `npm run build` 全量重建再重启。
- **真实 DB 是 `prisma\dev.db`**；根目录 `dev.db`（0 字节）是陷阱。
- 服务：一键启停 `WAH一键启动.bat` / `WAH一键停止.bat`（逻辑在 `scripts\launch-services.ps1`）：
  网页 next（3000 端口，用 `C:\Program Files\nodejs\node.exe` 启动，勿用沙箱版 node）+
  **常驻自动导入 `scripts\watch-auto-import.ts`**（扫描完成自动同步网页，日志 `logs\auto-import.*.log`）。

## 10. 常用命令 / 场景速查

```powershell
cd C:\Users\Hz\Documents\Workspace\Ah
npx tsc --noEmit && npx vitest run   # 类型检查 + 全量测试（153 用例）
npm run build                        # 生产构建（先停后台 audit 防 Prisma DLL 锁）
npm run auctionator:import           # 聚合价导入（幂等；不再写 vendor）
npm run transcript:import            # 档位导入（幂等，先删后插，覆盖现有 transcript）
npm run vendor:import                # 游戏内实时商人价导入（幂等；覆盖 Item.vendorPrice，最优先）
npm run watch                        # 常驻自动导入（唯一同步入口）：扫描完成自动同步网页，无需任何操作
npx tsx scripts/vendor-price-audit.ts  # vendor 价全量核对（可中断续跑；进度在 scripts/.vendor-audit-progress.json；跳过已有游戏内值）
node -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('prisma/dev.db');console.log(JSON.stringify(db.prepare('SELECT source,COUNT(*) n,MAX(timestamp) latest FROM AuctionSnapshot GROUP BY source').all()))"
```

- **"网页没更新"** → 先查 Auctionator SV 的 LastWriteTime 和 DB `MAX(timestamp) GROUP BY source`；
  结论几乎总是"游戏没落盘"→ 让用户 /reload 或登出再导入。
- **"XX 物品没名字/没价格"** → 名字缺失 = foreverchanges 未抓（M1b 待做）；价格缺失 = 未被扫描到；
  配方页标"缺货"。
- **"NPC 价格不对"** → vendor_price 来自旧 Auctionator 缓存（失真）→ 该物品在 vendor-price-audit
  覆盖范围内则等核对；不在（vendor_price=0）则查 foreverchanges 页面确认后手动 UPDATE。
- **AH 搜不到带前缀物品（"孤狼之轻身法杖"）** → 先确认拍卖行左侧分类选对（武器→远程→魔杖），
  再用**基础名**搜索（"轻身法杖"）；前缀（孤狼之/猎鹰之/医师之…）是随机前缀，同一基础物品
  （同 item id）的所有前缀变体在 AH 按同一 id 挂单，Auctionator 购物清单/搜索按基础名即可
  全部命中并拍下。
- **雷达条数异常** → 先看设置面板（RadarRule 当前值）与 vendor 核对进度；必赚只受 vendor 准确性
  影响（无门槛）；捡漏受最低盈利/历史/可信度/新鲜度窗口影响。
- **改查询/口径** → `repositories.ts`（mode 分叉）→ `analytics.ts`（buildMarketSignal）→
  `market-signals.ts`（缓存 key = mode:latestSnapshotAt:metaVersion）；页面层 `src\app\page.tsx`、
  `items\[itemId]\page.tsx`（history 开关）。

## 11. 用户偏好 / 协作纪律

- **回复用中文**；称呼、语气自然。
- **git**：不主动提交/推送；用户说"推/推一版"才 push，"提交git"才 commit。
- **公测清空（偏好）**：用户通知"公测开始"时清空全部运行时数据（网页 SQLite + 插件 SavedVariables +
  导入进度），代码与 git 保留；清空后历史模式仍可参考旧 P10 曲线，之后可删。
- 网页等长期服务在本机跑着，改动后别重启/杀错进程；导入数据是手动脚本，无常驻 watcher。
- **vendor 价权威顺序 = 游戏内实时商人价（WAHVendorDB）> foreverchanges.pro**：用户不接受拍卖行
  Auctionator 缓存价（买价÷组数，系统性失真）；修正 vendor 一律以游戏内实时价或网站"卖价"为准。
