# AH 项目跟进文件（HANDOFF · v3）

> **进入本项目的唯一必读入口**：先读本文件，再按需精读具体代码，不要通读整个仓库。
> 最后更新：2026-10-14（本地 UTC+2）。对应 git HEAD：本版随"雷达门槛精简 + vendor 全量核对"提交推送。
> **v2/v3 说明**：2026-10-13 起数据源已从自研插件切换为 Auctionator + M4 转录插件；旧自研插件
> 时代的一切历史记录（P10/P50、中立市场、账本、旧扫描链路等）**已全部失效**，本版不再保留。
> v3 新增：雷达门槛最终口径（用户拍板）、网页设置面板（含价格下限）、vendor 价全量核对机制。
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
| 转录插件（游戏内） | `...\Interface\AddOns\WoWderhoiAH-Transcript\`（仓库副本 `addon-transcript\`） |
| 转录存档（档位源） | `...\SavedVariables\WoWderhoiAH-Transcript.lua`（按插件名落盘） |
| 旧插件归档（勿恢复） | `archive\addon\WoWderhoiAH\`、下线功能 `archive\` |
| 导入脚本 | `scripts\auctionator-import.ts`（`npm run auctionator:import`）、`scripts\transcript-import.ts`（`npm run transcript:import`） |
| **vendor 全量核对** | `scripts\vendor-price-audit.ts`（后台/手动跑；断点续跑；限速防 403） |
| 共享解码 | `src\lib\auctionator-sv.ts`（readAuctionatorSavedVars / CBOR / Lua 转义） |
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
- **vendor（NPC 卖价）权威 = foreverchanges.pro 物品页"卖价"实测**（游戏内确认；页面无"卖价"字段 =
  NPC 不收 → 置 0）。Auctionator 缓存已弃用（§5-7），**旧缓存写入 DB 的失真值正在全量核对覆盖**（§5-9）。
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

## 6. 数据现状（2026-10-14）

- AuctionSnapshot：addon 473,663 / auctionator 3,519~3,520
- DailySummary：addon 47,606 / auctionator 6,771 / transcript 48（10-14 首轮 1 天）
- AuctionTier：transcript 254 档 / 48 物品（首轮，未覆盖全量）
- Item：5,445 + 65 占位；当前信号 3,521（无 addon）
- vendor_price>0：修正前 3,481（几乎全失真）→ **必赚区已修正 13 条真实值**；全量核对进行中
  （截至 2026-10-14 晚已核 400+，全部有效 0 失败）
- 雷达（当前设置：最低盈利 50 铜 / 历史 2 天 / 可信度 2 / 新鲜度 1 天，用户自调）：**36 条 =
  必赚 13 + 捡漏 23**；捡漏随新鲜度窗口与数据积累波动

## 7. 待办 / 未完成（按优先级）

1. **vendor 全量核对收尾**：`npx tsx scripts/vendor-price-audit.ts`（后台续跑，可中断续跑）。
   完成后重验：必赚区应只剩 vendor 真实 < minPrice 的物品；配方利润兜底不再被假 vendor 虚高。
2. **转录全量重扫**（M4 落地关键）：用户游戏内开拍卖行 → `/wahscan start`（3577 物品约 36 分钟）→
   登出 → `npm run transcript:import`（先删后插，会覆盖现有 48 物品数据）。
3. **M1b foreverchanges.pro 数据源**：物品/配方/vendor 全量抓取（限速）；配方缺货标注已做；用户会
   定期让扫新增可赚金币内容。vendor 已先行全量核对（本轮），剩物品名/配方抓取。
4. **POSTING_HISTORY**：当前为空（`{__dbversion=1}`），`PostingRecord` 表已建、解析口子就绪。
5. **开服清空运行时数据**（SQLite + SavedVariables + 导入进度；代码/git 保留），由用户通知触发。

## 8. git 状态

- HEAD = origin/main = 本版提交（M4f：雷达门槛精简 + 设置面板 + 价格下限 + 鼠标移出关闭 +
  vendor 全量核对脚本 + HANDOFF v3）。
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
- 服务：网页 next 监听 3000，用 `C:\Program Files\nodejs\node.exe` 启动（勿用沙箱版 node）；
  导入是手动脚本，无常驻 watcher。

## 10. 常用命令 / 场景速查

```powershell
cd C:\Users\Hz\Documents\Workspace\Ah
npx tsc --noEmit && npx vitest run   # 类型检查 + 全量测试（153 用例）
npm run build                        # 生产构建（先停后台 audit 防 Prisma DLL 锁）
npm run auctionator:import           # 聚合价导入（幂等；不再写 vendor）
npm run transcript:import            # 档位导入（幂等，先删后插，覆盖现有 transcript）
npx tsx scripts/vendor-price-audit.ts  # vendor 价全量核对（可中断续跑；进度在 scripts/.vendor-audit-progress.json）
node -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('prisma/dev.db');console.log(JSON.stringify(db.prepare('SELECT source,COUNT(*) n,MAX(timestamp) latest FROM AuctionSnapshot GROUP BY source').all()))"
```

- **"网页没更新"** → 先查 Auctionator SV 的 LastWriteTime 和 DB `MAX(timestamp) GROUP BY source`；
  结论几乎总是"游戏没落盘"→ 让用户 /reload 或登出再导入。
- **"XX 物品没名字/没价格"** → 名字缺失 = foreverchanges 未抓（M1b 待做）；价格缺失 = 未被扫描到；
  配方页标"缺货"。
- **"NPC 价格不对"** → vendor_price 来自旧 Auctionator 缓存（失真）→ 该物品在 vendor-price-audit
  覆盖范围内则等核对；不在（vendor_price=0）则查 foreverchanges 页面确认后手动 UPDATE。
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
- **vendor 价权威 = foreverchanges.pro**：用户不接受拍卖行插件缓存价；修正 vendor 一律以网站"卖价"为准。
