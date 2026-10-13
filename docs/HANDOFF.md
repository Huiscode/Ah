# AH 项目跟进文件（HANDOFF）

> **本文件是进入本项目工作的唯一必读入口**：先读它，再按需精读具体文件，不要通读整个代码库。
> 最后更新：2026-10-13（本地 UTC+2）。对应 git HEAD：`8ca4f53`（M1+M2 迁移，**本地已提交未推送**；
> M3 收尾 + 走势单线 + bait-filter 三版 + **M4 转录插件/档位过滤**全部未提交）。工作树含上述未提交改动。
> 语言：与用户用中文交流；代码/标识符保持英文。
>
> **2026-10-13 重大变更：数据源已从自研插件切换为 Auctionator**（见 §2/§6.29/§7）。
> 旧自研插件已废除（游戏目录已移除，源码归档在 `archive/addon/`）；网页当前口径 = Auctionator
> **最低买入价**；旧 Beta 插件数据（47 万行 P10）保留在库，通过**历史模式**（`?history=1`）查看。
> **M4（2026-10-13 晚）：新增转录插件 WoWderhoiAH-Transcript + 档位过滤**——Auctionator 存档只有
> 聚合价（m/l/h/a），无价格档位；转录插件用暴雪官方 API 逐物品扫出完整档位落盘，网页端按档位做
> "稀薄+断层"钓单过滤（见 §6.30）。

## 1. 项目是什么

WoW Forever 私服（`C:\Program Files (x86)\World of Warcraft\_classic_beta_\`，可执行 WowB.exe）拍卖行
行情**网页终端**（Next.js 本地）。数据来源：游戏内 **Auctionator** 插件（Forever 适配版）SavedVariables
落盘 + **M4 转录插件**（WoWderhoiAH-Transcript，完整价格档位落盘）→ 本地 Node 脚本解码导入 SQLite →
网页展示行情、捡漏雷达、配方利润、历史 P10 参考。自研插件（WoWderhoiAH.lua 扫描链路）已于 2026-10-13
废除并归档。

技术栈：
- 数据源：Auctionator 插件（`Interface\AddOns\Auctionator`，SV 为 Lua + CBOR 编码，**仅聚合价**）；
  转录插件 `Interface\AddOns\WoWderhoiAH-Transcript`（SV 明文 Lua，**完整档位**）
- 脚本：Node + tsx（`scripts\auctionator-import.ts`、`scripts\transcript-import.ts` 一次性导入；无常驻 watcher）
- 网页：Next.js App Router + Tailwind，Prisma + SQLite
- 测试：vitest

仓库：`origin=https://github.com/Huiscode/Ah.git`，分支 `main`。
项目根：`C:\Users\Hz\Documents\Workspace\Ah`。

## 2. 数据链路（核心，2026-10-13 起）

```
游戏内 Auctionator 插件（扫描拍卖行 → 内存价格库，落盘只有聚合价 m/l/h/a）
   │  ① 玩家手动触发全量扫描（每次进拍卖行）；价格库含每日快照 + 7 日历史
   │  ② 只有登出 / /reload 时客户端才把 SavedVariables 落盘（插件无法强制写盘）
   ▼
SavedVariables 文件（AQ_AUCTIONATOR_SV_PATH）
   │  ③ scripts\auctionator-import.ts（一次性，幂等：先删后插）：
   │     - 解码 Auctionator.lua（ASCII 转义 + 原始二进制混合 → 字节保真读；
   │       Lua 字符串 \DDD 十进制转义；CBOR byte-string 键 → 递归转对象）
   │     - PvP 槽价格库（按服务器类型命名，见 §8）→ AuctionSnapshot (source='auctionator')
   │     - 每日收盘 → DailySummary (source='auctionator')
   │     - VENDOR_PRICE_CACHE（单位=银，×100 转铜）→ Item.vendorPrice
   ▼
游戏内 转录插件 WoWderhoiAH-Transcript（M4，打开拍卖行 /wahscan start）
   │  ④ 逐物品 SendSearchQuery → 事件读完整拍卖条目 → 按单价聚合档位 [{p,q}]
   │     （暴雪官方 API，独立实现；物品清单 = AUCTIONATOR_PRICE_DATABASE 的 key）
   │  ⑤ 登出 / /reload 落盘 WAHTranscribeDB.lua（每物品只留最新一轮）
   ▼
scripts\transcript-import.ts（npm run transcript:import，幂等：先删后插）
   │  ⑥ fengari 执行存档取表 → AuctionTier (source='transcript'，完整档位)
   │     → tier-filter 有效最低价（剔除稀薄+断层钓单档）→ DailySummary (source='transcript')
   ▼
SQLite（Prisma）：prisma\dev.db
   ▼
网页：src\app\page.tsx（首页）/ items\[itemId]（单品）/ recipes（配方库）
```

**关键机制**：网页只能看到已落盘的数据。游戏内扫完想立刻同步 → 游戏里 `/reload` 或登出，然后重跑
`npm run auctionator:import`（聚合价）+ `npm run transcript:import`（档位）。

**三种数据源并存（source 列区分）**：
- `source='transcript'`（M4 起，**档位主源**）：最新价/在售量 = 最新一轮 AuctionTier 经 tier-filter
  的**有效最低价**（剔除"稀薄+断层"钓单档：第一档 1 单 vs 第二档 100 单取第二档；组累计稀薄且
  断层整组剔除）；7日参考 = transcript DailySummary 收盘中位数；雷达 universe/新鲜度锚点 = transcript
  最新轮。**无 transcript 的物品回退 auctionator**（渐进切换，扫到自然补齐）。
- `source='auctionator'`：当前口径 = **最低买入价 m**（最新快照）；7日参考 = 近 7 日
  DailySummary 收盘中位数（med7）；环比 = 日环比；雷达 universe = 最新 Auctionator 扫描轮。
  （M4 后仅作 transcript 缺失时的回退与历史参照。）
- `source='addon'`：旧自研插件 Beta 删档数据（47 万行 P10，截至 2026-10-06），仅**历史模式**
  （`?history=1`）查看：市场价 = P10，7日参考 = 快照 7 日 P10 中位数，环比 = 上次扫描。
- 页面两种模式互不混源：首页/单品页都有模式开关（URL 参数 `history=1`）；med7 SQL、走势、
  K线、配方价全部按模式过滤 source。口径断点 = **2026-10-13**（页头有标注）。

**已下线（2026-10-13）**：自研插件（游戏目录已删，归档 `archive/addon/`）、中立市场 `/neutral`、
跨市场 `/arbitrage`、成交账本 `/ledger`、价位阶梯面板、插件配套脚本（watch-savedvars、
gen-lua-rules、compare-radar-plugin-web 等）——全部归档在 `archive/`，路由已从网页移除。

> 历史背景（旧链路，已废除，仅留档）：自研插件曾以 `WoWderhoiAH_ScanData` 全局表（P10/P50 加权分位）
> 经 watch-savedvars 轮询导入。2026-10-06 曾有中立市场隔离（faction/neutral 槽位）；10-13 随插件
> 废除整体下线。

## 3. 关键路径速查

| 用途 | 路径 |
|---|---|
| 项目根 | `C:\Users\Hz\Documents\Workspace\Ah` |
| Auctionator 插件（游戏内，勿动） | `C:\Program Files (x86)\World of Warcraft\_classic_beta_\Interface\AddOns\Auctionator\` |
| Auctionator SV（数据源） | `C:\Program Files (x86)\World of Warcraft\_classic_beta_\WTF\Account\1120133458#1\SavedVariables\Auctionator.lua` |
| **转录插件（M4，游戏内）** | `C:\Program Files (x86)\World of Warcraft\_classic_beta_\Interface\AddOns\WoWderhoiAH-Transcript\`（仓库副本 `addon-transcript\`） |
| **转录存档（档位数据源）** | `C:\Program Files (x86)\World of Warcraft\_classic_beta_\WTF\Account\1120133458#1\SavedVariables\WAHTranscribeDB.lua` |
| 自研插件归档（旧代码，勿恢复） | `archive\addon\WoWderhoiAH\`（游戏目录已移除） |
| 下线功能归档 | `archive\`（pages/ api/ lib/ components/ data/ scripts/ addon/ + README） |
| 数据库 | **`prisma\dev.db`**（根目录 `dev.db` 是 0 字节空文件，勿用） |
| 共享解码库 | `src\lib\auctionator-sv.ts`（readAuctionatorSavedVars、auctionatorDayToUtcDay、decodeLuaString） |
| 导入脚本 | `scripts\auctionator-import.ts`（`npm run auctionator:import`，幂等） |
| **档位导入脚本（M4）** | `scripts\transcript-import.ts`（`npm run transcript:import`，幂等；fengari 解析 Lua 存档） |
| **档位过滤公式（M4）** | `src\lib\tier-filter.ts`（effectiveLowestPrice：稀薄+断层剔除；常量可调）+ 测试 `tier-filter.test.ts` |
| M0 验证工具 | `scripts\auctionator-m0-decode.ts` |
| 迁移计划（唯一权威） | `docs\plans\auctionator-migration-plan.md` |
| 环境变量（导入用） | `AQ_AUCTIONATOR_SV_PATH`、`AQ_AUCTIONATOR_REALM_SLOT="PvP"`、`AQ_SERVER="Classic Beta PvP 2"`、`AQ_FACTION="Alliance"`；`.env` 里 DATABASE_URL(file:./dev.db→实际 prisma/dev.db) |

网页库模块（src\lib\）：`repositories.ts`（DB 访问，MarketMode 参数）、`analytics.ts`（行情信号/雷达，
buildMarketSignal 支持 mode）、`market-signals.ts`（按快照代+mode 缓存）、`freshness.ts`（7 天窗口）、
`auctionator-sv.ts`（解码）、`market-data.ts`（SnapshotSource）、`recipe-profits.ts`、`alerts.ts`、
`secondary-materials.ts`、`market-filter.ts`、`market-rules.ts`（雷达阈值常量）。

## 4. 运行中的服务与进程

**无常驻数据导入服务**（watch-savedvars 已随插件废除下线）。只有网页服务：
- next（dev 或 start，监听 3000）：用 `C:\Program Files\nodejs\node.exe` 启动，勿用沙箱版 node。
  手动示例：`Start-Process "C:\Program Files\nodejs\node.exe" -ArgumentList "node_modules\next\dist\bin\next","start","-p","3000" -WorkingDirectory <root> -WindowStyle Hidden -RedirectStandardOutput logs\web.out.log -RedirectStandardError logs\web.err.log`。

数据更新流程：游戏内扫描 → /reload 落盘 → 手动 `npm run auctionator:import` → 刷新网页。
（`scripts\launch-services.ps1` 仅启网页服务，如需可查看内容。）

## 5. 测试与验证命令

```powershell
cd C:\Users\Hz\Documents\Workspace\Ah
npx tsc --noEmit               # 全项目类型检查，退出 0
npx vitest run                 # 全量测试（当前 123 用例）
npm run build                  # 生产构建
# 导入 Auctionator 数据（幂等，先删后插）：
#   AQ_AUCTIONATOR_SV_PATH=... AQ_AUCTIONATOR_REALM_SLOT="PvP" AQ_SERVER="Classic Beta PvP 2" AQ_FACTION="Alliance" npm run auctionator:import
# 直接查 DB（node 22 内置 sqlite）：
node -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('prisma/dev.db');console.log(JSON.stringify(db.prepare('SELECT source,COUNT(*) n,MAX(timestamp) latest FROM AuctionSnapshot GROUP BY source').all()))"
# 冒烟（起服务后）：首页、历史模式、单品页两模式、配方页
#   Invoke-WebRequest http://localhost:3000/            （当前模式，含口径标注）
#   Invoke-WebRequest "http://localhost:3000/?history=1"（历史模式横幅）
#   Invoke-WebRequest http://localhost:3000/items/2589          / "...?history=1"
#   Invoke-WebRequest http://localhost:3000/recipes
# 注意：Next 增量构建偶发旧 chunk 残留（如历史模式 500），先 `Remove-Item .next -Recurse -Force` 全量重建
```

## 6. 最近完成的工作

> **6.1~6.28 均为旧自研插件时代的记录，已随 2026-10-13 数据源迁移全部失效**（插件已废除）。
> 当前状态只看 **6.29（迁移）** 与 **§7**；旧记录保留仅作历史留档，勿据此恢复功能。
> （6.1~6.18 已提交并 push；6.19~6.28 随 `20172a7` 提交推送；迁移后为 `55b2c8e` → `8ca4f53`，见 6.29。）

### 6.1 出售助手窗口不关闭修复（commit f3e0cc9，Trade.lua）
三个根因：hook 闭包引用了未声明 local 的 sellAssist（每处关闭都在 pcall 里静默死掉）、全局 itemId 残留、
ItemDisplay 返回 stale ID。修复：前向声明、hook 驱动的 sellSlotState 表 + ItemLocation 复核、两条购买成功路径
（物品/堆叠商品）显式 closeSellAssist。测试 `addon\test\sell-assist.test.ts`（6 用例）。

### 6.2 成交账本掉单修复（commit f3e0cc9，Ledger.lua）
现象："昨天拍卖的 3s 大型铜壳炸弹成交没进账本"。根因：**Forever 客户端 `GetInboxHeaderInfo` 返回值比经典
客户端前多一个字段（邮件 id），整体错位一位**——"拍卖成功"纯金币邮件被读成 itemCount≈133890、发件人当 subject、
money=0 → 误判"流拍"记成垃圾 expired，真实 sell 永不生成（产生 4 条 qty=133890 垃圾，今早 5:46/5:48）。
修复：
- 按内容定位解析：找发件人锚点（"拍卖行"/"Auction House"），锚点后第一个数字=金额、之前两项=邮件 id/itemCount；
- 去重：有 per-mail id 按 id 精确去重，无则 subject+money+itemCount 计数去重；`MAIL_SHOW` 不再清空去重表；
- `pruneGarbage()` 加载时清理 qty>10000 的 expired；
- itemId 反查：`WAH.itemIdByName`（历史从未赋值，已弃用）→ scan cache → buy 记录。
测试 `addon\test\ledger-mail.test.ts`（4 用例：Forever 错位布局 sell/expired、重扫不去重、同价双邮件分别记账、经典布局兜底）。

### 6.3 数据修复（已执行，未提交——改的是运行数据）
- SV 文件删除 4 条垃圾 expired（uid 1790826407-4/5、1790826510-6/7）；
- 网页 DB 删除同 4 条 + 补录 1 条 sell：uid=`backfill-4370-20261001`、itemId=4370、qty=1、total=300、
  ts=1790826407（=2026-10-01T03:46:47Z）、note="拍卖成功：大型铜壳炸弹"；
- 验证：SV 现 3 条 buy；GET /api/import/ledger 现 4 条（3 buy + 1 sell）。

### 6.4 推送
- `f3e0cc9` fix(addon)：6 个 addon 文件（Trade/Ledger.lua + 4 个测试/桩）——用户说"推"后推送；
- `ac7e8ca` chore：WIP 快照 17 文件（用户工作区里未提交的网页改动 + 新脚本）——用户说"先推一版"后推送。
- 规则：**只有用户明确说"推/推一版"才 git push；只提交点名范围，用户其他 WIP 保持不动**。

### 6.5 网页性能优化（2026-10-01，已改代码，**未提交未推送**）
用户报"刷新网页非常慢"。实测定位：首页 17s（冷）/6.8s（热）、/api/market 12-17s。根因是数据库查询设计：
- `getMarketUniverse()` 用 Prisma `include: {snapshots: {take:-48}}` 拉全部 37.8 万行快照再在 JS 截断（5s）；已改为 **3 条原生 SQL 窗口函数**（每 item 最近 48 快照 + 30 日汇总，且快照查询不取 raw_payload 大字段）→ **1206ms**；
- `getLatestLadders()` 原来拉全部 31.8 万行 addon 快照在 JS 取第一条（1.7s）；已改为 **窗口函数每 item 取最新一条有 payload 的行** → **271ms**（entries 1440，语义等价，4370 等 ladder<2 档的物品正确跳过）；
- `/api/market` 原来无缓存每次全量重算（12-17s）；已改为**复用 `getMarketSignals()` 的快照代缓存** → **427ms**；
- 首页实测 **~2.3s**（原 17s/6.8s）。tsc 通过、159 用例全过。
- **坑**：Prisma `$queryRaw` 对 Json 列返回**已反序列化的对象**，不要对返回值再 `JSON.parse`（会得到 "[object Object]" 报错）；raw_payload 存在 ladder<2 档的行属正常（getLatestLadders 要求 ≥2 档才记录）。

### 6.6 NPC必赚链路修复（2026-10-01，已部署 + reload 验证通过，**未提交未推送**）
现象：雷达从未出现"NPC必赚"。根因：插件 `itemCategoryAndVendor()` 调用 `C_Item.GetItemInfoByID`，
该客户端**不存在**此 API（三轮游戏内探针实测），vendorP 恒 0 → Class 1 判定永不成立。
修复：改用 `C_Item.GetItemInfo(itemId)`（1基布局：6=itemType、7=itemSubType、10=iconFileDataID、
11=sellPrice、12=classID、13=subclassID；`GetItemClassInfo/GetItemSubClassInfo` 均为 nil），
同款修复 GUI.lua/Trade.lua。部署哈希一致，用户 /reload 后扫出"黄铁矿 [NPC必赚] 20"验证生效。
测试：`addon\test\scan-category.test.ts`（2 用例，钉死布局契约）。

### 6.7 翡翠 7日参考两页口径统一（2026-10-01，已修复，**未提交未推送**）
现象：首页"7日参考 23s97" vs 单品页"7日参考 10s"不一致。根因：首页 med7 走 `getMed7Aggregates()`
SQL 全窗口聚合，单品页走截断后的 snapshots 数组本地重算（96 条截断引入偏差）。
修复：`med7Info` SQL 全窗口聚合统一两页口径（翡翠=880）。测试/API 实测通过。

### 6.8 砍掉 AHledger 网站通道 + P10/P50 双曲线（2026-10-01，已实施，**未提交未推送**）
用户拍板：网站数据是另一服务商的 P50 口径，与插件 P10 混用造成两页不一致与口径混乱；且
"扫描即实时"是误解（replicate 是快照）。方案：**单一数据源（游戏插件扫描）+ 每轮同时产出
P10/P50 两条 close，P50 仅作展示**。实施：
- 插件 `finishScan`：items 增 `p50`（weightedPercentile 0.50），Points 每点增 `c50`；`SCAN_PIPELINE_VERSION` 3→4（旧扫描/旧 Points 整体作废，P50 曲线从下次扫描起重新积累约 2 天）；
- 数据层：`AuctionSnapshot` 增列 `alt_price`（BigInt?）；`addon-scan.ts`/`import-common.ts`/`repositories.ts`/`market-data.ts` 全链路读 P50；`importSnapshot` 移除 ahledger 过滤与占位 Item 分支；
- UI：单品页盘中走势固定 P10（主）+P50（展示）双线，K线/季节/市场价/7日参考全部固定 P10；首页删 `AhledgerToggle`、footer 与雷达文案改"自扫P10"；
- 删除：`scripts/ahledger-importer.ts`、`src/app/api/{ahledger/toggle,import/ahledger}`、`src/components/ahledger-toggle.tsx`、`scripts/{backfill-item-categories,prune-ahledger-only}.ts`、package.json `ahledger:sync`、启动/停止脚本中 ahledger 段；
- 进程：ahledger-importer（12080→8256）已停；DB：`DELETE source='ahledger'`（快照+日汇总全清）、占位 Item、`AppState.ahledgerEnabled` 全清，清理脚本保留为 `scripts/purge-ahledger-history.ts`（幂等）；
- 验证：tsc 0 错、全量 183 用例通过、插件已部署哈希一致（WoWderhoiAH.lua=7F752C3F…、GeneratedRules.lua=5E29C2EB…）、DB 剩余 ahledger 行=0。**用户需游戏内 /reload 生效并重新扫描**。

### 6.9 "网页端刷新无数据"排查与修复（2026-10-01，已解决，**未提交未推送**）
现象：用户 /reload + 重扫后，网页仍显示"数据更新于 31 分钟前"，新扫描不进来。实际是**两个叠加问题**：
1. **watcher 进程跑着旧代码**：watch-savedvars 是早 5:44 启动的，tsx 不热重载，内存里 `SCAN_PIPELINE_VERSION` 还是 3；游戏落盘的是 v4 扫描，版本门禁 `dataVersion !== SCAN_PIPELINE_VERSION` 把它拦下，导致新扫描永不导入。→ 重启 watcher（用 Program Files node，见 §4）。
2. **next dev 服务端 bundle 里是旧 @prisma/client**：schema 加 `alt_price` 后曾 `prisma generate` 报 EPERM（query_engine dll 被 next dev 锁定），磁盘 client 虽更新，但 next dev 的 .next 缓存内联了旧的校验器 → 新代码（importSnapshot 传 altPrice）运行时报 `Unknown argument altPrice`（命令行列测试则正常，因为命令行加载新 client）。→ 停服务 → 重新 `npx prisma generate` → **删 `.next` 清缓存** → 重启，错误消失，成功导入 1991 items（07:27:08Z）。
3. **附带发现**：SV 单次落盘会触发多次 watch change 事件 → 并发两次导入，第二次撞 `item_id` 唯一约束报错（数据无损伤，但极端下两次都过 timestamp 去重会插双份）。已在 `importLatestScan` 加 `importInFlight` 互斥锁（finally 释放，tsx 重启生效）。
4. 验证：DB 最新 addon 快照 = 1790839628000（09:27:08 CEST），`alt_price` 填充 1991 行（P50 已开始积累）；`/api/market` 2665 signals / 1.8s；首页 NPC必赚 8 条、单品页 P10/P50 图例与 7日参考正常。
5. **用户端注意**：浏览器如仍显示旧页面，**硬刷新**（Ctrl+F5）一次——next dev 重启 + 删 .next 后旧 JS chunk 缓存会失效。

### 6.10 修复命令备忘（下次再遇"新扫描不进来"）
- 查 SV `dataVersion`/`scannedAt` → `.watch-state.json` → `logs\addon-watch.out.log` 有无 `Imported` 行；
- watcher 没导入：先确认进程启动时间早于 SCAN_PIPELINE_VERSION 改动 → 重启 watcher；
- API 报 `Unknown argument`：删 `.next` + `npx prisma generate` + 重启 next dev。

### 6.11 账本一键清空（二次确认）（2026-10-01，已实现，**未提交未推送**）
用户要求"持仓账本页面一键清空账本且有二次确认"。坑：watcher 每次 SV 落盘都会把整本账本重新
POST /api/import/ledger（upsert by uid），只删 DB 会被下一次上传灌回来。方案：
- 新增 `POST /api/ledger/clear`（`src\app\api\ledger\clear\route.ts`）：**先**写 AppState
  `ledgerClearedAt`（unix 秒）**再** `tradeRecord.deleteMany`；
- 导入路由 `src\app\api\import\ledger\route.ts` POST 开头读 `ledgerClearedAt`，跳过 `ts <= clearedAt`
  的记录（清空后旧记录永不回流，新流水 ts 更大照常导入）；
- 账本页新增 `src\components\clear-ledger-button.tsx`（"use client"）：页头"清空账本"按钮 →
  模态框二次确认（提示不可恢复 + 旧记录不再导入）→ POST → `router.refresh()`；
- 验证：tsc 0 错、全量 189 用例通过；用 dev.db 副本跑链路（导入旧记录→清空→旧记录重传
  imported=0/skipped=2→新记录 imported=1→GET 仅剩新记录）；真实库未动（6 条无测试行无标记）；
  页面 HTTP 200 含按钮、GET 该路由 405（仅 POST）。
- 已知小竞态（已注释）：清空瞬间若恰好有上传在途，可能回流少量旧记录，再点一次清空即可；本地单机可接受。
- 游戏内 SavedVariables 里的旧账本不会删除，只是导入时被 `ledgerClearedAt` 过滤。

### 6.12 项目结构整理（2026-10-01，已执行，**未提交未推送**）
用户要求"用项目经理方法整理整个 AH 结构"。全部为移动/归档，不改代码：
- **根目录清理**：18 个历史遗留日志（addon-watch/dev/WAH-*/watcher.log 等旧进程产物）→ `logs\archive\`；
  `.inspect.cjs`、`.tmp-luacheck\`（luaparse 临时依赖）→ `docs\archive\`。当前服务日志只写 `logs\`
  （launch-services.ps1），不受影响。
- **docs 分层**：`docs\reports\`（favor / consumables 两份审计报告移入）；`docs\archive\`（全部 `.tmp-*`
  一次性产物，新增索引 `README.md`）；新增 `docs\README.md` 文档索引；`HANDOFF.md` 仍为入口。
- **引用同步**：两份审计报告中指向"项目根 / scripts"的 `.tmp-*` 路径已改为 `docs\archive\` 实际位置。
- **未动**：`src\`、`addon\`、`prisma\`、`public\`、`scripts\`（生产脚本）、根 README/CHANGELOG/CONTRIBUTING/SECURITY
  （GitHub 惯例 + README 内部相对链接）、一键启动/停止 bat、根 `dev.db` 0 字节陷阱（保留以免误用，见 §8）。
- 验证：服务未中断（watcher 21204→4464、next dev 21080→20588）、`npx vitest run` 189 用例全过、
  `tsc --noEmit` 0 错。

### 6.13 移除 logo + 推一版（2026-10-01，已推送）
- 用户指示：删除 `docs/logo-256.png`、`docs/logo.svg`（确认网页 src/ 与 public/ 均无引用）→ 已删；
  同步移除 README.md 头部 `<img src="docs/logo-256.png">` 与 docs/README.md 的品牌资源行（否则 GitHub 首页破图）。
- **后续（见 6.14）**：用户确认后，`logo.tga` / `render-logo.ts` / `logo:render` / TOC `IconTexture` 已一并清除，游戏目录副本同步删除。
- 推送：commit `b0a3dca`（34 文件，87183+/80-），内容为"推一版"快照——6.5~6.12 全部未提交改动 + 结构整理 +
  logo 移除 + 账本清空 + 流通分审计报告/数据/脚本；已 push origin main，本地=远端。
- **防护**：`.gitignore` 新增 `prisma/dev.db.bak-*`，97MB 的 `prisma/dev.db.bak-20261001-consumables` 未入库。

### 6.14 清除 logo 残留（2026-10-01，已提交推送 9a32f5a）
- 背景：用户实测游戏内插件列表从未显示图标——Forever 1.60.1 客户端插件列表纯文字，不渲染 `logo.tga`；
  `logo.tga` 虽已部署（游戏目录 16KB）但客户端不显示，整条 logo 链路无实际用途。
- 清除：`addon\WoWderhoiAH\logo.tga`（仓库 + 游戏目录副本）、`scripts\render-logo.ts`、package.json
  `logo:render` 条目、`WoWderhoiAH.toc` 的 `## IconTexture` 行（指向已删文件）；更新后的 TOC 已同步游戏目录。
- 部署流程只复制 `*.lua`，本次不影响后续部署与哈希校验；需要时均可从 git 历史恢复。
- 验证：tsc 0 错、vitest 28 文件 189 用例全过；服务未动。

### 6.15 配方库审计与回填（2026-10-02，未提交）
- 背景：用户问"10-01 配方/物品扫描后，网页端配方库面板是否需要补充或修改"。用线上同款管线
  （getRecipes + getMarketSignals + computeRecipeProfits）全量核对：Recipe 2265 条（craft 1945 +
  merchant 320，页面注释写死 1953/290 已过时）、可算利润 475、缺价 1790（79%）、1724 个配方产出
  物品缺 Item 行、2 条工程消耗品配方（4365/274048）只存在于 forever-consumables.json 未入表。
- 修复（脚本 `scripts/backfill-recipe-library.ts`，幂等可重跑）：
  ① **2 条工程配方入表**：劣质炸药配方（4365，skill 75，材料 粗制火药粉×3+亚麻布，产出 劣质炸药×2）、
    9-60电池组（274048，skill 125，材料 天蓝染料+黄铁矿+铁锭，spell 1293088）。数据来自
    `docs/archive/.tmp-page-engineering.html`（foreverchanges 工程页实抓）。**命名规则（用户 10-02 指定）**：
    配方名 = 物品同名 + "配方"两字——4365 命名"劣质炸药配方"（与低级配方 4358"劣质炸药"区分，
    Recipe 唯一键 (name, profession, category) 不冲突）。
  ② **NPC 材料卖价补字典**（`src/data/vendor-prices.ts`）：6 条原 pending（itemId=0）的 Forever
    常驻材料 ID 已由扫描确认，提升为正式条目——品红染料 249430=250、翠绿染料 249431=375、
    砂纸 249432=250、天蓝染料 249409=125、黄铁矿 249391=100、无瑕鳞片 249429=375。
    （保留：属 NPC 保底价体系，非"等 AH"补价；用户如要连这些也等 AH 可再撤。）
  ③ **产出物品 Item 行补录 1727 条**：名字/品质取自 `docs/archive/.tmp-items-list-1..20.html`
    （9,708 件新增/改动清单中命中 476 件）或配方 outputs JSON 兜底；category=其它、sub_category=未知
    （与既有占位行一致）；缺 Item 行数 1724 → **0**。列表页只覆盖"新增或改动"物品，经典未改动物品
    由配方 JSON 补名/品质。产出 NPC 收购价一律不补（见下方缺价方针）。
  ④ **页面文案**（`src/app/recipes/page.tsx`）：注释 1953/290 → 1947/320（实际值，数字以面板"统计"
    卡为准）；build 描述改"wx-wow 69913 + 客户端 1.60.1（以游戏内实装为准）"——网站不同页面
    70124/70170 显示不一致，不再写死网站小版本。
- **缺价方针（用户 10-02 指定）**：所有有数据但缺价格的物品/产出只保留"缺价"标记，不做任何补价
  （不做材料成本递推引擎、不抓详情页补产出卖价），等 AH 扫描到该物品时自然有价。据此已撤销
  274048 的 2500 铜卖价（曾实抓自详情页"卖价：25银"），9-60电池组保持缺价。
- 结果（真实页面 GET /recipes 验证）：Recipe **2267**（craft 1947 + merchant 320）、可算利润
  **475 → 477**、缺价 **1790**（数字与基线持平但构成已变：+2 新配方中粗制炸药 ok、9-60电池组缺价；
  品红染料等 NPC 材料不再缺价）。剩余缺价大头：熟化毛皮/魔化皮/奥金锭/精华等制造类材料与产出物品，
  按方针保留缺价标记，等 AH 自然补上。
- 验证：tsc --noEmit 0 错；页面 HTTP 200 且两条新配方已渲染。未提交（用户未说推）。

### 6.16 主城扫描可靠性修复 0.3.1→0.3.3（2026-10-04，已推 7520d4d）
现象：主城拍卖行（约 5 万物品）经常扫描失败"12 秒内未收到复制数据"，野外中立拍卖行（约 2000
物品）秒扫成功——两者是**两套独立市场**，行价互不参考。修复（看门狗按用户要求 60s→180s）：
复制启动看门狗放宽到 3 分钟；空数据守卫（禁止 0 条假成功）；流式增长 + 停滞追读；
静默丢弃时自动重试一次；每条改动走"备份→双向同步→哈希→luaparse→vitest"闭环。
0.3.3 稳定表现：第一次失败后自动重扫几秒出数据（用户实测 93767 条拍卖 → 2425 种商品）。

### 6.17 曲线窗口仅拍卖行开启时显示 0.3.4（2026-10-05，已推 593b9c3）
商人/背包/链接等普通悬浮提示只保留价格信息窗口；价格曲线窗口仅在拍卖行界面开启时显示
（对照图：商人场景原同时弹曲线+价格两窗）。

### 6.18 捡漏筛选并入雷达 + 中间材料利润面板（2026-10-06，已推 dd0ae7f）
- 删除捡漏筛选面板；价格下限/上限/最低盈利条件移入捡漏雷达头部"仅限高流通商品"右侧，
  条目计数"56/856"移到最右侧；
- 首页价格档位上方新增"中间材料利润"面板：定义=由初级材料合成/分解得到的物品（亚麻卷、铜锭、
  石头、附魔材料等）且被其它配方消耗的产物；**按专业分类筛选下拉**（持久化键
  `wah:secondary-materials:profession`）；
- 雷达物品用**流通分**替代"被X配方"徽章（turnoverBadgeClass 五档）；删除"仅显示 XX"六字。

### 6.19 最低盈利改整池筛选 + 配方库专业 tab 固定顺序（2026-10-06，commit 8a46464，已随 20172a7 推送）
捡漏雷达"必赚最低盈利"改名"最低盈利"且作用域=**整个雷达池**的最低盈利筛选（非单条必赚）；
配方库专业 tab 顺序固定。

### 6.20 市场隔离 0.3.5：中立扫描独立槽位 + 网页 market 维度（2026-10-04~06，已随 563cf47 提交、20172a7 推送）
背景：用户问"扫描了中立拍卖行会不会覆盖错误数据到我的联盟拍卖行？"——核查：**会，且已发生**
（10-04 10:29:37Z 一轮 523 商品/1717 挂单确为中立，污染了 523 种商品 7 日历史）。方案三件套：
- 插件 0.3.5：`finishScan` 按挂单总数 ≥20000（WAH.MARKET_SPLIT_AUCTIONS）判 faction/neutral；
  neutral 写 `WoWderhoiAHDB.neutralScanData`（不覆盖 scanData、不写 Points、不进网页导入）；
- 网页端：schema 加 `market String @default("faction")` + 索引 `[server,faction,market,timestamp,source]`；
  AddonScan/ImportPayload 透传 market；normalize 归一（仅显式 "neutral" 为 neutral，其余 faction）；
  dedupe/points 探测/两张 createMany 带 market；`getLatestSnapshotTime`/`getLatestAddonRoundItemIds`/
  `getMarketUniverse`/`getMed7Aggregates`/ladder 路由全部按 market='faction' 过滤；
- 清理：删除 10-04 中立轮 523 行（残留 0），按联盟剩余数据重算当日日线（2544→2541）。
验证：luaparse 7 文件全过、插件 74/74（含中立隔离用例）、全量 197/197、tsc 干净、
market 分布 faction 全量；首页实测正常。踩坑：Prisma generate 在 next dev 运行时 EPERM
（DLL 被占用）→ 停进程再生成；雷达 0 条 = 2 小时新鲜度闸门设计行为（信号层健康）。

### 6.21 0.3.6 相对阈值尝试 → 已回退（2026-10-06，已随 563cf47 提交、20172a7 推送）
用户问"第一天扫不足两万条怎么办"→ 试做相对市场参考 + 冷启动（MARKET_MIN_FACTION_RATIO=0.25、
classifyMarket、槽位记 auctions），测试 1 处失败未查。用户叫停并要求复原 0.3.5 → 已回退
（游戏目录+源码恢复 0.3.5，哈希核对一致，测试回 74/74）。0.3.6 版本保留在
`WoWderhoiAH.lua/toc.bak-0.3.6`（游戏目录与 addon 源码目录各一份）。

### 6.22 0.3.7 开服 7 天宽限（2026-10-06，已随 563cf47 提交、20172a7 推送）
采纳用户的时间方案替代绝对阈值冷启动：**首次扫描起 7 天内，无论扫到多少挂单一律按联盟拍卖行收；
7 天后恢复 2 万阈值**（WAH.MARKET_GRACE_DAYS=7）。
细节：游戏无服务器开服时间 API → 锚点 = 插件首次扫描时间（`WoWderhoiAHDB.firstScanAt`）；
**已有 scanData 的账户（老用户升级）不重新进入宽限**——阈值立即生效，中立扫描依旧走独立槽位。
测试 +2（宽限内 2 条挂单也按联盟收、老账户不重进宽限）：插件 76/76、全量 199/199、tsc 干净；
游戏目录+源码哈希一致，TOC 0.3.7。用户已 /reload（SV 10-06 18:18 落盘）。

### 6.23 上涨物品扫描 + 关注物品写入（2026-10-07，已随 20172a7 推送）
- 用户要求：从开服至今持续上涨的物品（参照=褶皱地衣），最终口径（用户 10-07 拍板）：
  **首周内 P10 均值 vs 最近一周内 P10 均值，涨幅 ≥30%，不管中间波动；最近一周在售量中位数 ≥100 件；基准价 ≥300 铜**。
  首周=首轮起 7 天（2026-09-24~10-01），最近一周=最新轮往前 7 天；start/end=窗口内全部轮 P10 的**平均**。
- 数据前置清理：10-04 两轮中立残留（07:26Z 549 行、10:29Z 523 行）从 faction 槽位 DELETEs 共 1072 行；
  重建 10-04 日线 2502 行（脚本 `rebuild-daily2.cjs`，先 DELETE 当日旧行再 INSERT 9 列——`DailySummary`
  表实际无 created_at/updated_at 列，schema 与库表不一致的遗留，插入勿写这两列）。
- 结果 34 个（褶皱地衣 +54% 第 14 名入选；榜首无瑕皮革 +551%）；明细脚本
  `analyze-rise-simple.cjs`（代理工作区），结果以 Markdown 表格交付（用户明示"不用划线"）。
- 34 个全部写入 `Watchlist`（INSERT OR IGNORE：+30 新增、4 原有=褶皱地衣/坚固的石头/硫酸/天蓝染料）。
  当前 Watchlist 19 条（用户后续自行增减过）。

### 6.24 关注星标/配方即时同步（2026-10-07~08，已随 20172a7 推送）
用户两次要求"加减关注立即体现、不需要手动刷新"：
- **关注物品星标**（`watch-star.tsx`）：原仅 server action + revalidatePath，客户端不刷新→面板不即时。
  重写为 useState 乐观翻转 + useEffect 同步 props + startTransition 内 await toggleWatchlist 后
  `router.refresh()`（强制重拉 RSC），失败回滚。市场表/雷达/单品页/关注面板全部即时同步。
- **关注配方**（收藏在 localStorage `wah:favorite-recipes`，非 DB）：`use-persisted-state.ts` 加
  `window.addEventListener("storage")`——**跨标签页**（配方库页 ↔ 首页面板）双向即时同步；
  同标签页本就即时。附带：所有 usePersistedState 状态跨标签页保持一致（增强，无副作用）。

### 6.25 雷达筛选调整：删两条件 + 新增价位阶梯筛选（2026-10-08，已随 20172a7 推送）
- 删除面板头部"价格上限"与"最低盈利"两个筛选（状态/过滤/输入框，localStorage 旧值残留无害），
  保留 全部品类/仅限高流通商品/价格下限/条目计数。
- 新增两个筛选："价位1比价位2低 %"、"价位2比价位3低 %"——**价位1/2/3 = 最新扫描挂单档位价格**
  （`rawPayload.ladder` 前 3 档，从低到高，即"价格档位"面板的价格1/2/3），不是雷达表的
  最低价/市场价/7日参考。语义：最低档 ≤ 次低档×(1-X%)、次低档 ≤ 第三档×(1-Y%)；启用时缺档的行被过滤。
- 数据链路：`MarketHistory.ladder`（market-data.ts）← `getMarketUniverse` 新增**最新 addon 轮**
  ladder 查询（repositories.ts；只取 MAX(timestamp) 一轮，避免 JSON 大字段拖慢全量查询）→
  `MarketSignal.ladder` / `DealRadarRow.ladder`（analytics.ts）→ deal-radar-table 两输入框。
- 覆盖率实测（10-07 最新轮 2574 行）：全部带 ladder，≥2 档 61%、≥3 档 43%；"价位1比价位2低30%"
  样例命中 415 条。持久化键 `wah:deal-radar:ladder12` / `wah:deal-radar:ladder23`。

### 6.26 插件复制失败背退 + 静默诊断（2026-10-08~09，已随 20172a7 推送；游戏目录已同步，需 /reload 生效）
- 现象（用户 10-08 报"扫描卡住"）：主城复制请求经常被服务器**静默丢弃**（IsThrottled=no、事件不触发、
  请求后 3 秒列表条目=0）——测试服主城大拍卖行（9 万+挂单）常态，注释里 Forever 亦有记录。
- 原缺陷：watchdog 最终失败路径**不设置新冷却**（冷却只在 finishScan 成功时刷），自动重扫每 20s 检测
  冷却→失败后几乎立即重发→无限循环 3 分钟等待 = 用户看到的"卡住"。
- 修复（WoWderhoiAH.lua）：失败放弃后设 `replicateReadyAt = time() + REPLICATE_FAIL_BACKOFF(60s)`；
  复制发起 3 秒后的应答探针改为静默记录 `scanState.replicateAckCount`，**仅最终失败时**打印
  （`SCAN_DIAG_REPLICATE_ACK`，正常扫描聊天框干净）。重试路径保持不变（5s 后重试，最多 2 次）。
- **TOC 版本号未升**（仍 0.3.7）；游戏目录=源码副本哈希一致；用户需 /reload 生效。

## 7. 当前状态与待办（重要）

1. **数据源（M4 起）= transcript 档位主源 + Auctionator 聚合回退**；旧 Beta P10 数据（47 万行 addon）
   在**历史模式**（`?history=1`）可看，两模式页面/查询互不混源。DB 现状：AuctionSnapshot addon
   473,663 / auctionator 3,519；DailySummary addon 47,606 / auctionator 6,771 / **transcript 0**（等
   用户真实扫描导入）；Item 5,445+65 占位；**AuctionTier 0 行（等真实扫描）**。口径断点 2026-10-13
   已在页头标注。
2. **git**：HEAD=`8ca4f53`（M1+M2 迁移，本地已提交**未推送**）；`55b2c8e` 为迁移前最后快照。
   **M3 + 走势单线 + bait-filter 三版 + M4 全部未提交**（用户说"提交git"才提交本地，说"推"才 push）。
   工作树无残留杂物。
3. **待办（用户已拍板，按优先级）**：
   - **转录插件首扫（M4 落地关键）**：用户游戏内 /reload → 打开拍卖行 → `/wahscan start`（约 1-2
     小时/轮，后台挂着）→ 登出/重载 → `npm run transcript:import` → 网页档位口径生效。首轮前
     transcript 表为空、网页回退 auctionator（当前可见行为不变）。
   - **M1b 网站数据源**：foreverchanges.pro（https://foreverchanges.pro/zh-cn）设为物品/配方数据源
     （抓取限速）；配方缺价/缺记录标注"缺货"；拍卖行物品扫到自然补齐；过一段时间用户会让扫一次
     看有没有新增可赚金币物品（M1b 抓取未开工，物品名缺失目前靠现有 Item 表兜底）。
   - **雷达流动性门观察**：已删挂单数门槛（Auctionator 无挂单数），用户先观察是否要加"最低价钓单
     防护"（l 均值/在售量门槛）；M4 档位过滤已覆盖扫描内钓单，雷达维度是否联动未拍板。
   - **开服后清空全部运行时数据**（网页 SQLite + 插件 SavedVariables + 导入进度），代码与 git 保留，
     由用户通知触发；清空后历史 P10 曲线仍可经历史模式参考，之后再按用户指示删除。
4. **游戏内现状**：AddOns 含 Auctionator, Baganator, Cell, DungeonsForever, ForeverMapFix, OPie,
   Syndicator, **WoWderhoiAH-Transcript（M4 新增）**（**WoWderhoiAH 已移除**）。
5. **测试基线**：154 用例 + tsc 0 错 + production build 全绿（M4 冒烟已验证两模式页面 200、模拟档位
   数据有效价正确）。

## 8. 已知坑 / 机制限制（务必记住）

- **SV 落盘时机**：Auctionator 与旧插件相同——不周期性落盘，登出 / /reload 才写；插件 API 无法强制
  写盘。游戏内扫完必须 /reload 或登出，再跑导入脚本，网页才能看到新数据。
- **Auctionator.lua 解码三坑**（`src/lib/auctionator-sv.ts` 已处理）：① 文件是 ASCII 转义 + 原始二进制
  混合 → `readFileSync` 无编码（latin1）字节保真读；② Lua 字符串转义含 `\DDD` 十进制；③ CBOR 键是
  byte string → 返回 Map 需递归转对象。改解码逻辑后用 M0 脚本验证真实样本。
- **VENDOR_PRICE_CACHE 单位=银**（经典 GetMerchantItemPrice 返回银）→ 导入 ×100 转铜。
- **槽名 `PvP` 按服务器类型命名**（价格库 `["PvP"]` 槽），换服务器需改 `AQ_AUCTIONATOR_REALM_SLOT`。
- **TimeOfLastBrowseScan 是"浏览"而非全量扫描时间**：以 SV 文件 mtime / 快照 MAX(timestamp) 为准；
  新鲜度窗口 7 天（AUCTIONATOR_STALE_MAX_AGE_MS）吸收手动扫描间隔。
- **Auctionator 无 P10/P50/ladder/挂单数**：当前口径=最低买入价 m（易被低价钓单拉低，捡漏假阳性
  概率上升——阈值已改网页侧常量 market-rules.ts）；7日参考=每日收盘中位数；走势只有日线无盘中。
- **PostingRecord 表已建但 POSTING_HISTORY 当前为空**（`{__dbversion=1}`），结构未适配；Auctionator
  配置开启 posting history 后才有数据。
- **Prisma `$queryRaw` 的 Json 列**返回已反序列化对象，不要再 `JSON.parse`。
- **真实 DB 是 `prisma\dev.db`**；根目录 `dev.db`（0 字节）是陷阱。
- **Next 增量构建偶发旧 chunk 残留**（症状：单页 500 而源码/直调正常）→ `Remove-Item .next -Recurse
  -Force` 后 `npm run build` 全量重建。
- **首页冷查询 ~7.5s**（47 万行聚合），market-signals 有内存缓存，首跳后正常；历史模式首页同样较重。
- 时间换算锚点：1790826407 = 2026-10-01 03:46:47 UTC；关键物品 ID：亚麻布=2589、魔纹布=4338、
  小飞刀=2947、美味鼠尾鱼=21217、大型铜壳炸弹=4370。
- 旧插件时代的坑（P10/P50 语义、中立市场、faction/neutral 槽位、插件部署哈希等）**已随插件废除
  失效**，见 §6 历史留档。

### 6.27 中立拍卖行入网页 M1（zone 判定 + neutral 导入 + /neutral 页，未提交未推）

用户确认中立拍卖行 = **艾尔文森林 ↔ 赤脊山交界三角路口贸易营地**（板条箱提交点），要求把中立数据
做到网页并规划跨市场倒卖（M2 待做）。本轮交付 M1：
- **插件 0.3.8（WoWderhoiAH.lua）**：新增 `WAH.MARKET_ZONES_FACTION/NEUTRAL` 区域白名单（中英文 zone
  名）；`finishScan` 市场判定改为 **宽限 → 中立白名单 → 阵营白名单 → 挂单数阈值兜底**，并把
  `zone = GetRealZoneText()` 写进 scanData / neutralScanData。未知 zone 回退旧阈值逻辑，行为不变。
- **watcher（watch-savedvars.ts）**：新增 `importNeutralScan()`，独立游标 `lastImportedNeutralScanAt`
  （.watch-state.json），读 `WoWderhoiAHDB.neutralScanData` POST 同一 import 端点（market="neutral"
  由 normalizeAddonScan 透传 → importSnapshot 落库 market='neutral'）；与 faction 导入共用一把锁。
- **查询/页面**：`getLatestSnapshotTime(market?)` 参数化；新增 `getNeutralMarketLatest()`（中立最新
  一轮物品+价格）；首页头部双新鲜度（"联盟·数据更新于 / 中立·更新于"）+ 中立市场链接；
  新页 `src/app/neutral/page.tsx` 只读表格（P10/最低挂单/在售量/挂单数，按市场价降序）。
- **测试**：scan-category 新增 zone 白名单 2 用例（wow-stub 加可配置 GetRealZoneText，默认 "" 走阈值
  兜底）；addon-scan 新增 market=neutral 归一用例。全量 **202 用例通过、tsc 0 错、next build 成功**。
- **部署**：插件已复制游戏目录哈希一致；watcher 已重启（新代码生效）；`/neutral` 页 HTTP 200（当前
  空状态提示"尚无中立市场数据"）。**用户需游戏内 /reload + 去三角路口扫一次中立**，SV 落盘后
  neutralScanData.zone 可见真实 zone 名，网页 /neutral 即有数据。
- 未做：zone 不落库（AuctionSnapshot 无 zone 列，M1 页面文案写死位置）；M2 跨市场差价面板待做。
- 遗留决策点：中立费率是否按 15% 经典值；是否需要中立 Points 历史（当前中立不写 points）。

### 6.28 跨市场倒卖比较面板 M2（未提交未推）

用户"做下一步吧"后实施 M2（核心功能），当前 DB **尚无 neutral 行**（等用户 /reload + 三角路口
扫描），页面空态已按"缺哪边"精确提示。
- **src/data/market-fees.ts**：费率常量 `{ faction: 0.05, neutral: 0.15 }`（经典怀旧服值，页面标注
  "以游戏实收为准"，成交一单核对后改这里）。
- **src/lib/cross-market.ts**（纯函数 + 单测）：`buildCrossMarketRows` 两市场最新轮配对（只取两市场
  都有物品）、价差% = |f−n|/min、方向（联盟→中立 / 中立→联盟）、预计净利 = 卖侧 P10×(1−卖侧费率)
  − 买侧最低档价（ladder 第 1 档，无则 P10 兜底）、陈旧门槛 7 天（任一侧超时标"陈旧"，不参与
  "仅可操作"）；`attachItemMeta` 回填名称/品质/分类/图标。
- **repositories.ts `getCrossMarketSides()`**：faction/neutral 各自最新轮按 item_id JOIN 输入；任一方
  无数据返回空数组但保留有数据侧的时间戳（页面据此区分缺哪边）。
- **/arbitrage 页**：跨市场倒卖面板 —— 联盟价/中立价/价差%/方向/预计净利/买侧量/卖侧量/挂单数/
  状态；筛选：价差≥（10/30/50/100%）、买侧量≥（无/5/20/50）、仅可操作、排序（净利/价差%），
  全 URL 参数；免责标注费率假设 + 中立价可能陈旧 + 低量慎倒 + 跑图成本提示；首页头部加"跨市场"
  链接（/neutral 与 /arbitrage 并列）。
- **验证**：vitest 206 用例全过（新增 cross-market 4 用例）；tsc 0 错；next build 成功（/arbitrage
  已注册）；HTTP 200 且空态正确显示"已有联盟数据，但还没有中立数据"；首页含 /arbitrage 链接。
- 未做：M3 清单（配方利润面板增强/挂单深度/抄底信号/中立供给差高亮等，见计划 §5）；费率实测。
- 注意：/arbitrage 空态判断用时间戳而非数组长度（查询在任一方无数据时两侧数组都为空）——已修。

### 6.29 数据源迁移至 Auctionator（M0~M3，2026-10-13，commit 8ca4f53 已提交本地未推送）

用户拍板（10-13）：**废除自研插件版**，改用同客户端已安装的 Auctionator 插件为网页提供数据——
纯解析其 SavedVariables（CBOR），不装桥接插件。规划 `docs/plans/auctionator-migration-plan.md` 为唯一权威。
逐项决策：① 放弃中立/跨市场/账本（下线归档）；② 老 Beta P10 数据保留，**历史模式开关**
（首页/单品页 `?history=1`）查看；③ 接受最低买入价 m 口径（Auctionator 无 P10/P50/ladder），
7日参考=近 7 日每日收盘中位数；④ 采纳：历史模式开关、代码归档不删、POSTING_HISTORY 解析口子、
网站抓取限速；否决：最低价钓单防护、price_history_days 调大、抓取节奏当周化（用户先观察）；
⑤ 物品名来源=foreverchanges.pro（M1b 未开工）；配方缺价改"缺货"标注。

- **M0 PoC**：`scripts/auctionator-m0-decode.ts` 验证真实 SV 解码，三坑：ASCII 转义+原始二进制混合
  → 字节保真读（readFileSync 无编码 → latin1）；Lua `\DDD` 十进制转义；CBOR byte-string 键 → Map
  递归转对象。3145 物品，SCAN_DAY_0=2020-01-01 本地时区；亚麻布 19 铜与 DB 旧数据吻合。
- **M1 数据层**：`src/lib/auctionator-sv.ts`（共享解码）+ `scripts/auctionator-import.ts`（先删后插幂等）
  + schema 新增 `PostingRecord`。**VENDOR_PRICE_CACHE 单位=银**（经典 GetMerchantItemPrice 返回银）
  → ×100 转铜（小飞刀 14 银=1400 铜验证）。入库：3144 快照 + 3621 每日（day 2471~2477）+ 127 vendor
  更新 + 64 新 Item 占位。
- **M2 页面/查询适配**：med7=近 7 日 DailySummary 收盘中位数、当前价=最新快照 m、环比=日环比、
  雷达 universe=最新 Auctionator 轮、新鲜度窗口 7 天（AUCTIONATOR_STALE_MAX_AGE_MS，手动扫描频率）。
  下线功能归档 `archive/`（/neutral /arbitrage /ledger 页面+API、cross-market/ladders/market-fees、
  价位阶梯面板、清账本按钮、自研插件本体 addon/、gen-lua-rules/compare-radar-plugin-web/
  watch-savedvars 脚本）。雷达删除挂单数流动性门（无挂单数，用户选择先观察不加替代门槛），阈值
  改网页侧常量 market-rules.ts。配方"缺价"→"缺货"。验证：123 tests + typecheck + build 全绿；
  真实启动验证首页/配方页/单品页 200 无下线残留。**commit 8ca4f53**（68 文件 +1845/-507，本地未推）。
- **M3 收尾**（本小节完成，未提交）：游戏内 `Interface\AddOns\WoWderhoiAH` 目录已移除（17 文件，
  仓库 archive/addon/ 有备份）；查询层全面支持 `mode`（repositories.ts getMed7Aggregates/
  getMarketUniverse/getItemDetail/getLatestPricesByItemIds/getLatestRoundItemIds/getLatestSnapshotTime、
  analytics.ts buildMarketSignal(mode) 恢复旧 P10 口径、market-signals.ts 缓存 key 含 mode）；
  页面层历史模式开关（URL `?history=1`，首页/单品页横幅 + 口径断点标注"数据口径自 2026-10-13 起为
  Auctionator 最低价"）；全量验证 123 tests + tsc + build 绿，冒烟：首页两模式、单品页两模式
  （item 2589 history 200 含 P10）、api items 全 200。**坑**：Next 增量构建曾产生旧 chunk 致单品页
  历史模式 500（"Argument itemId is missing"），`Remove-Item .next` 全量重建后消失——遇此先重建。
- 遗留小项：TimeOfLastBrowseScan=1791349669（2026-10-07，"浏览"而非全量扫描时间，7 天窗口已吸收）；
  POSTING_HISTORY 当前空（{__dbversion=1}，结构未适配，表已建）；首页全量查询 ~7.5s 冷（market-signals
  内存缓存后正常）。

### 6.30 M4：转录插件 + 档位过滤（2026-10-13 晚，未提交）

背景（用户连续拍板）：
- Auctionator 存档**只有聚合价**（探查 3529 物品全部字段 = a,l,h,m），无价格档位；但其 UI 显示档位表
  （内存有完整列表）。用户要求档位级钓单过滤：**第一档 1 单 vs 第二档 100 单 → 记录第二单**；
  "1+2 档累计比第三档少一半且断层 → 整组剔除"；**量大低价是捡漏机会，绝不剔**；目标=把 NPC 必赚式
  极低钓单与极端高价钓单摘出 7 日均线，同时保留捡漏信号。
- Auctionator 仓库自带 AGENTS.md 版权声明（不得以其代码为参考基准）→ 转录插件**独立实现**
  （暴雪官方 C_AuctionHouse API + 老插件自有逻辑参考，只读 Auctionator SV 数据作物品清单，不抄其代码）。

交付：
- **M4a 转录插件** `addon-transcript\`（已装游戏 `Interface\AddOns\WoWderhoiAH-Transcript\`，luaparse
  语法校验过）：打开拍卖行 `/wahscan start [fresh]|stop|resume|status` → 逐物品 SendSearchQuery →
  COMMODITY/ITEM_SEARCH_RESULTS_UPDATED 事件读完整条目 → 按单价聚合档位 [{p,q}] → 落盘
  `WAHTranscribeDB.lua`（每物品只留最新一轮；断点续扫存 `WAHTranscribeState`；事件驱动串行 + 0.6s
  节流 + 8s 超时跳过）。物品清单 = `AUCTIONATOR_PRICE_DATABASE` 的 itemId 键（数据互操作）+ 可选
  `WAH_TRANSCRIPT_EXTRA` 白名单。**提示用户：扫描约 1-2 小时/轮（3529 物品 × ~0.6s），保持拍卖行
  打开，扫完正常登出/重载才落盘。**
- **M4b 档位过滤公式** `src/lib/tier-filter.ts`（纯函数 + 13 测试）：`effectiveLowestPrice(tiers)`——
  按"价格组"处理：同组=与下一档价差 < gapRatio(1.3)；遇断层时若"组累计 < 下一档数量 × cumRatio(0.5)"
  → 整组剔除，否则取组内最低档为有效最低价；总量 < minTotal(3) 不过滤（真实低流通保底）；最后一档
  恒稳定。常量 `TIER_FILTER_RULES` 可调。
- **M4c 数据层**：schema 新增 `AuctionTier`（itemId/ts/server/faction/market/source/price/qty，索引
  [itemId,ts]、[ts]）；`scripts/transcript-import.ts`（npm run transcript:import）用 **fengari** 执行
  存档取表（坑：fengari 需 `to_luastring` 转换、`lua_next` 迭代体内不可递归、数组/记录按 **key 的
  Lua 类型**区分——字符串 "2589" 与数字 2589 不同键）→ AuctionTier 全量重建 + tier-filter 聚合
  transcript DailySummary（每日代表价 = 当日最后扫描有效价，先删后插幂等）。
- **查询层接入**（当前模式 transcript 优先，无则回退 auctionator；历史模式不动）：
  `getTranscriptLatestSnapshots()` 合成快照（有效最低价 + 有效档在售量）→ getMarketUniverse /
  getItemDetail / getLatestPricesByItemIds；getMed7Aggregates 按 `CASE source='transcript' THEN 0
  ELSE 1` 优先选源；getLatestRoundItemIds / getLatestSnapshotTime 优先 transcript 最新轮。analytics/
  页面零改动（合成快照 source='transcript' 与 transcript daily 同源对齐）。
- **验证**：154 tests 全过（tier-filter 13 + bait-filter 全量）+ tsc 0 错 + 全量 build；模拟存档导入
  验证：8172 钓单（5000×1 vs 10000×100）→ 有效价 10000 ✓；9999（总量<3）保底 50 ✓；2589 正常 100 ✓；
  无 transcript 物品（36）回退 auctionator ✓；历史模式 8172 仍 addon 39900 ✓。测试假数据已清理。
- **坑**：fengari 无类型声明（src/types/fengari.d.ts 补）；luaparse 曾临时 --no-save 安装做 Lua 语法
  校验（未污染 package.json）；prisma db push 遇 web 服务占用 query_engine dll → 先停 3000 再 push。

## 9. 用户偏好 / 协作纪律

- **回复用中文**；称呼、语气自然。
- **git**：不主动提交/推送；只有用户明确说"推/推一版"才 push；说"提交git"才提交本地；只提交点名范围。
- **公测清空（偏好）**：用户通知"公测开始"时清空全部运行时数据（网页 SQLite + 插件 SavedVariables +
  导入进度），代码/git/备份保留；届时先与用户确认范围再执行。清空后历史模式仍可参考旧 P10 曲线，
  之后可删。
- 网页等长期运行服务在本机跑着，改动后注意别重启/杀错进程；导入数据是手动脚本，无常驻 watcher。

## 10. 下一步常见场景速查（给下一个 AI）

- **用户说"网页没更新/数据更新于 X 前"** → 先查：Auctionator SV 文件 LastWriteTime、DB
  `MAX(timestamp) GROUP BY source`。结论几乎总是"游戏没落盘"：让用户 /reload 或登出，然后重跑
  `npm run auctionator:import`。
- **用户问"XX 物品怎么没名字/没价格"** → 名字缺失=foreverchanges.pro 数据源未抓（M1b 待做，现有
  Item 表兜底）；价格缺失=该物品未被 Auctionator 扫描到，扫到自然补齐；配方页标"缺货"。
- **动查询/口径** → 读 `src\lib\repositories.ts`（mode 分叉）/ `analytics.ts`（buildMarketSignal）/
  `market-signals.ts`（缓存 key）；页面层 `src\app\page.tsx`、`items\[itemId]\page.tsx`（history 开关）。
- **历史模式相关** → URL `?history=1`；查询层 getMed7Aggregates(itemIds, mode) 等全部带 mode 参数；
  history=addon 快照 P10 旧口径，current=auctionator 最低价。
- **雷达条数异常** → 先分模式看：current 模式雷达只推荐最新 Auctionator 轮在售物品（universe 过滤）；
  历史模式看 addon 轮。阈值在 `src\lib\market-rules.ts`。
- **Import 报错** → 读报错按 §8 解码三坑排查；脚本幂等可重跑；`scripts\auctionator-m0-decode.ts`
  可独立验证解码。
