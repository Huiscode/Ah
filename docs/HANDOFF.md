# AH 项目跟进文件（HANDOFF）

> **本文件是进入本项目工作的唯一必读入口**：先读它，再按需精读具体文件，不要通读整个代码库。
> 最后更新：2026-10-01（本地 UTC+2）。对应 git HEAD：`b0a3dca`（已 push）。
> 语言：与用户用中文交流；代码/标识符保持英文。

## 1. 项目是什么

WoW Forever 私服（`C:\Program Files (x86)\World of Warcraft\_classic_beta_\`，可执行 WowB.exe）拍卖行插件
**WoWderhoiAH**（Lua）+ **Next.js 本地网页终端**（localhost:3000）混合项目。插件在游戏内扫拍卖行/收件箱，
数据经 SavedVariables 落盘后被本地 Node 脚本导入 SQLite，网页展示行情、捡漏雷达、成交账本、配方利润。

技术栈：
- 插件：Lua（WoW 1.12 系 API，私服有魔改）
- 脚本：Node + tsx（`scripts\`）
- 网页：Next.js App Router + Tailwind，Prisma + SQLite
- 测试：vitest + fengari（在 Node 中加载真实 Lua 测试插件逻辑）

仓库：`origin=https://github.com/Huiscode/Ah.git`，分支 `main`。
项目根：`C:\Users\Hz\Documents\Workspace\Ah`。

## 2. 数据链路（核心）

```
游戏内插件（WoWderhoiAH.lua 扫描 AH + Ledger.lua 扫邮箱）
   │  ① 内存表：WoWderhoiAH_ScanData（全局，SCAN_PIPELINE_VERSION=4）、WoWderhoiAHDB.ledger
   │  ② 只有登出 / /reload 时客户端才把 SavedVariables 落盘（插件无法强制写盘）
   ▼
SavedVariables 文件（AQT_SAVEDVARS_PATH）
   │  ③ scripts\watch-savedvars.ts 轮询文件（每 tick）：
   │     - importLatestScan：dataVersion===4 且 scannedAt 严格 > lastImportedScanAt 才导入
   │       → POST /api/import/addon-scan（写 AuctionSnapshot，source="addon"）
   │     - uploadLedger：每 tick 上传账本 → POST /api/import/ledger（upsert by uid，幂等）
   ▼
SQLite（Prisma）：prisma\dev.db
   ▼
网页：src\app\page.tsx（首页）/ ledger（成交账本）/ items\[itemId]（单品）/ recipes（配方库）
```

**关键机制**：网页只能看到已落盘的数据。游戏内扫完想立刻同步 → 游戏里 `/reload` 或登出。

> 2026-10-01：AHledger 网站数据通道已整体移除（importer 进程、路由、toggle、相关脚本与
> 历史数据全部清理）。`AuctionSnapshot` 增列 `alt_price`（P50 close，展示用）；市场价/7日参考
> 仍统一为插件扫描的 P10 口径，P50 仅作单品页盘中走势的展示曲线，不参与雷达与参考价。

## 3. 关键路径速查

| 用途 | 路径 |
|---|---|
| 项目根 | `C:\Users\Hz\Documents\Workspace\Ah` |
| 插件源码 | `addon\WoWderhoiAH\`（WoWderhoiAH.lua 主入口/扫描、Trade.lua 出售助手、Ledger.lua 邮箱账本、Settings.lua、GUI.lua、GeneratedRules.lua、Locale.lua） |
| 游戏插件目录（部署目标，需哈希一致） | `C:\Program Files (x86)\World of Warcraft\_classic_beta_\Interface\AddOns\WoWderhoiAH\` |
| SavedVariables（AQT_SAVEDVARS_PATH） | `C:\Program Files (x86)\World of Warcraft\_classic_beta_\WTF\Account\1120133458#1\SavedVariables\WoWderhoiAH.lua` |
| 数据库 | **`prisma\dev.db`**（~90MB；根目录 `dev.db` 是 0 字节空文件，勿用） |
| watcher 状态 | `scripts\.watch-state.json`（`lastImportedScanAt`） |
| 日志 | `logs\`（addon-watch / web 的 out/err.log；node stdout 是文件缓冲，0 字节≠没跑，stderr 空才说明无错误）；历史遗留日志归档在 `logs\archive\` |
| 插件测试 | `addon\test\`（wow-lua.ts 桥 + wow-stub.lua 桩 + 各 *.test.ts） |
| 启动服务 | `scripts\launch-services.ps1`（幂等，重复运行不会重复启动） |
| 环境变量 | `.env`：DATABASE_URL(file:./dev.db→实际 prisma/dev.db)、AQT_SAVEDVARS_PATH、AQT_IMPORT_URL（AHL_* 为已移除通道的残留配置，无代码读取） |

网页库模块（src\lib\）：`analytics.ts`（行情信号/雷达）、`repositories.ts`（DB 访问）、`market-signals.ts`（按快照代缓存）、
`freshness.ts`（"数据更新于"标签）、`market-filter.ts`、`alerts.ts`、`recipe-profits.ts`、`ladders.ts`、`addon-scan.ts`、`scan-import.ts`、`import-common.ts`、`daily-summary.ts`。

## 4. 运行中的服务与进程（2026-10-01 早上启动）

| 服务 | 进程（tsx 父→node 子 = **1 个逻辑实例**，勿当重复杀） | 说明 |
|---|---|---|
| watch-savedvars | 2368 → 16076（Program Files node） | 监视 SV → 导入（已加并发锁） |
| next dev | 2160（next dev）→ 11824（start-server，监听 3000） | 网页（Program Files node） |
| 游戏 | WowB.exe（用户环境） | — |

**不要**因为看到每个脚本 2 个 node 进程就去 kill：那是 tsx CLI 父 + 执行子进程的一对。

> 2026-10-01：ahledger-importer 已随通道移除而停掉并删除，不再启动。
> **服务必须用 `C:\Program Files\nodejs\node.exe` 启动**——agent 工具环境的 PATH 里 node 是 DoubaoWork 沙箱版
> （sandbox_runtime\...\node.exe），用它启动会生成挂在沙箱下的服务进程，与用户环境不一致。手动启动示例：
> `Start-Process "C:\Program Files\nodejs\node.exe" -ArgumentList "node_modules\next\dist\bin\next","dev","--webpack" -WorkingDirectory <root> -WindowStyle Hidden -RedirectStandardOutput logs\web.out.log -RedirectStandardError logs\web.err.log`。

## 5. 测试与验证命令

```powershell
cd C:\Users\Hz\Documents\Workspace\Ah
npx vitest run addon/test/     # 插件测试：10 文件 71 用例（含 scan-category 2、sell-assist 6、ledger-mail 4）
npx tsc --noEmit               # 全项目类型检查，退出 0
npx vitest run                 # 全量：27 文件 183 用例
# 网页账本现状：
Invoke-RestMethod http://localhost:3000/api/import/ledger
# 直接查 DB（node 22 内置 sqlite）：
node -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('prisma/dev.db');console.log(JSON.stringify(db.prepare('SELECT source,COUNT(*) n,MAX(timestamp) latest FROM AuctionSnapshot GROUP BY source').all()))"
# 部署插件：把 addon\WoWderhoiAH\*.lua 复制到游戏插件目录并比对哈希
```

## 6. 最近完成的工作（均已提交并 push）

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

## 7. 当前状态与待办（重要）

1. **游戏内 /reload + 重新扫描已执行且数据已导入**（10-01 09:27:08 CEST，v4 扫描 1991 items，`alt_price` 1991 行已落库）。P50 曲线从该轮起积累，约 2 天形成完整曲线。
2. **用户需浏览器硬刷新（Ctrl+F5）一次**：next dev 重启 + 删 .next 后旧 JS chunk 缓存会失效，普通刷新可能仍显示旧页面。
3. **主页"数据更新于"机制（已查清）**：`latestSnapshotAt = MAX(AuctionSnapshot.timestamp)`，现在只有 addon 单通道，无跨通道歧义。
4. 6.5~6.12 全部改动已随 `b0a3dca` 提交并推送（见 6.13）；当前唯一未提交改动为本 HANDOFF 的记录更新。

## 8. 已知坑 / 机制限制（务必记住）

- **SV 落盘时机**：实测该客户端不周期性落盘（10-01 5:44 启动 → 5:50 落盘 → 6:23 再落盘）。登出//reload 才写。
  插件 API 无法强制写盘。→ 游戏内扫完必须 /reload 或登出，网页才能看到新数据。
- **Prisma `$queryRaw` 的 Json 列**（如 AuctionSnapshot.raw_payload）返回的是**已反序列化的 JS 对象**，不要再 `JSON.parse`；拿不到需要的列时明确 `SELECT` 列而非 `SELECT *`（避免 Prisma 对 11 万行大字段做反序列化）。
- **Forever `GetInboxHeaderInfo` 布局错位**（见 6.2，Ledger.lua 已按内容锚点处理）。
- **真实 DB 是 `prisma\dev.db`**；根目录 `dev.db`（0 字节）是陷阱。Prisma 相对路径基于 schema 目录解析。
- **tsx 父子进程对**：见第 4 节，勿杀。
- **logs\ 0 字节**：node stdout 文件缓冲，不代表进程没干活；stderr 为空才说明无错误。
- 时间换算锚点：1790826407 = 2026-10-01 03:46:47 UTC = 05:46:47 CEST（本地 UTC+2）；
  1790803107 ≈ 2026-09-30 23:18 CEST；1790822889 = 10-01 04:48:09 CEST。
- 关键物品 ID：大型铜壳炸弹=4370（成交 3s / 买入 2s25c）、魔纹布=4338、亚麻布=2589、小飞刀=2947、美味鼠尾鱼=21217。
- **P10/P50 语义**：P10=按挂单量加权的 10 分位价（买家真实成交价，市场价/7日参考口径）；
  P50=同扫描的 50 分位价（市场中心，仅展示）。P50 历史上有 v2 用其做市场价被高价钓单污染的教训，故只做展示。

## 9. 用户偏好 / 协作纪律

- **回复用中文**；称呼、语气自然。
- **git**：不主动提交/推送；只有用户明确说"推/推一版"才 push；只提交点名范围；用户工作区常有大堆未提交 WIP，保持原样。
- 网页/数据库等长期运行服务都在本机跑着（见第 4 节），改动后注意别重启/杀错进程。
- 游戏内改动部署到游戏目录后要提示用户 /reload 生效。

## 10. 下一步常见场景速查（给下一个 AI）

- **用户说"网页没更新/数据更新于 X 前"** → 先查：SV 文件 scannedAt 与 LastWriteTime、`.watch-state.json`、
  DB `MAX(timestamp) GROUP BY source`。结论几乎总是"游戏没落盘"，按第 7 节答复。
- **动插件逻辑** → 读 `addon\WoWderhoiAH\` 对应 .lua；测试改 `addon\test\`（桥/桩：wow-lua.ts、wow-stub.lua）；改完跑 vitest + tsc，复制到游戏目录并比对哈希。
- **动网页** → 读 `src\lib\` + `src\app\` 对应文件；页面/组件改动跑 tsc；DB 结构改动需注意 prisma/dev.db 与 schema 一致性（加列用 `npx prisma db push`，勿忘同时改 `addon-scan.ts`/`import-common.ts`/`repositories.ts`/`market-data.ts` 的类型与 SQL SELECT 列）。
- **查账本** → `GET http://localhost:3000/api/import/ledger`；**清空账本** → 账本页页头按钮（二次确认，`POST /api/ledger/clear`）。
