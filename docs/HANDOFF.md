# AH 项目跟进文件（HANDOFF）

> **本文件是进入本项目工作的唯一必读入口**：先读它，再按需精读具体文件，不要通读整个代码库。
> 最后更新：2026-10-01（本地 UTC+2）。对应 git HEAD：`ac7e8ca`（已 push）。
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
   │  ① 内存表：WoWderhoiAH_ScanData（全局，SCAN_PIPELINE_VERSION=3）、WoWderhoiAHDB.ledger
   │  ② 只有登出 / /reload 时客户端才把 SavedVariables 落盘（插件无法强制写盘）
   ▼
SavedVariables 文件（AQT_SAVEDVARS_PATH）
   │  ③ scripts\watch-savedvars.ts 轮询文件（每 tick）：
   │     - importLatestScan：dataVersion===3 且 scannedAt 严格 > lastImportedScanAt 才导入
   │       → POST /api/import/addon-scan（写 AuctionSnapshot，source="addon"）
   │     - uploadLedger：每 tick 上传账本 → POST /api/import/ledger（upsert by uid，幂等）
   ▼
SQLite（Prisma）：prisma\dev.db
   │  ④ ahledger-importer.ts（独立进程）每 15 分钟拉 AHledger 网站价目表
   │     → POST /api/import/ahledger（source="ahledger"）；时间戳用网站数据头 observedAt，非轮询时间
   ▼
网页：src\app\page.tsx（首页）/ ledger（成交账本）/ items\[itemId]（单品）/ recipes（配方库）
```

**关键机制**：网页只能看到已落盘的数据。游戏内扫完想立刻同步 → 游戏里 `/reload` 或登出。

## 3. 关键路径速查

| 用途 | 路径 |
|---|---|
| 项目根 | `C:\Users\Hz\Documents\Workspace\Ah` |
| 插件源码 | `addon\WoWderhoiAH\`（WoWderhoiAH.lua 主入口/扫描、Trade.lua 出售助手、Ledger.lua 邮箱账本、Settings.lua、GUI.lua、GeneratedRules.lua、Locale.lua） |
| 游戏插件目录（部署目标，需哈希一致） | `C:\Program Files (x86)\World of Warcraft\_classic_beta_\Interface\AddOns\WoWderhoiAH\` |
| SavedVariables（AQT_SAVEDVARS_PATH） | `C:\Program Files (x86)\World of Warcraft\_classic_beta_\WTF\Account\1120133458#1\SavedVariables\WoWderhoiAH.lua` |
| 数据库 | **`prisma\dev.db`**（~90MB；根目录 `dev.db` 是 0 字节空文件，勿用） |
| watcher 状态 | `scripts\.watch-state.json`（`lastImportedScanAt`） |
| ahledger 状态 | `scripts\.ahledger-state.json`（`lastObservedAt`） |
| 日志 | `logs\`（addon-watch / ahledger-sync / web 的 out/err.log；node stdout 是文件缓冲，0 字节≠没跑，stderr 空才说明无错误） |
| 插件测试 | `addon\test\`（wow-lua.ts 桥 + wow-stub.lua 桩 + 各 *.test.ts） |
| 启动服务 | `scripts\launch-services.ps1`（幂等，重复运行不会重复启动） |
| 环境变量 | `.env`：DATABASE_URL(file:./dev.db→实际 prisma/dev.db)、AQT_SAVEDVARS_PATH、AQT_IMPORT_URL、AHL_API_BASE、AHL_MARKET、AHL_SERVER、AHL_FACTION、AHL_IMPORT_URL、AHL_POLL_SECONDS(900) |

网页库模块（src\lib\）：`analytics.ts`（行情信号/雷达）、`repositories.ts`（DB 访问）、`market-signals.ts`（按快照代缓存）、
`freshness.ts`（"数据更新于"标签）、`market-filter.ts`、`alerts.ts`、`recipe-profits.ts`、`ladders.ts`、`addon-scan.ts`、`scan-import.ts`、`import-common.ts`、`daily-summary.ts`。

## 4. 运行中的服务与进程（2026-10-01 早上启动）

| 服务 | 进程（tsx 父→node 子 = **1 个逻辑实例**，勿当重复杀） | 说明 |
|---|---|---|
| watch-savedvars | 28852 → 12644（父进程 16160=launcher） | 监视 SV → 导入 |
| ahledger-importer | 12080 → 8256（父进程 16160） | 轮询 AHledger |
| next dev | 20364（start-server.js 监听 3000）、10796（next dev） | 网页 |
| 游戏 | WowB.exe PID 28760（5:44 启动，运行中） | — |

**不要**因为看到每个脚本 2 个 node 进程就去 kill：那是 tsx CLI 父 + 执行子进程的一对。

## 5. 测试与验证命令

```powershell
cd C:\Users\Hz\Documents\Workspace\Ah
npx vitest run addon/test/     # 插件测试：9 文件 69 用例（含 sell-assist 6、ledger-mail 4）
npx tsc --noEmit               # 全项目类型检查，退出 0
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

## 7. 当前状态与待办（重要）

1. **用户需要在游戏内 `/reload`**（尚未确认是否已执行）：
   - 加载修复后的 Trade.lua / Ledger.lua（部署已同步、哈希一致）；
   - 新 Ledger.lua 启动时 `pruneGarbage()` 会清掉游戏内存里的 4 条垃圾账本；
   - **reload 前游戏若再次落盘，4 条垃圾会回流到网页 DB**：已发生一次——10-01 06:23:32 游戏落盘（覆盖了人工清理的 SV 文件，SV 现在含垃圾+新扫描），垃圾曾回流，**已于 10-01 06:4x 再次从网页 DB 删除**（现 4 条：3 buy + 1 补录 sell）；若再回流凭 uid 1790826407-4/5、1790826510-6/7 删除。
   - reload 后主页"数据更新于"会更新为最新扫描时间。
2. **主页"数据更新于"机制（已查清）**：
   - 显示逻辑：`page.tsx:62` `describeFreshness(latestSnapshotAt, new Date())`，`latestSnapshotAt = MAX(AuctionSnapshot.timestamp)`（跨 addon + ahledger 两通道）；
   - 今早 5:54:18 / 6:09:58 两轮 addon 扫描**已导入网页**（各 2006/2005 条，DB 最新 addon 快照 1790827798=06:09:58 本地）；`.watch-state.json` 已推进到 1790827798；
   - ahledger 通道最新 = 1790822889（AHledger 网站该服数据轮 04:48，**站点自己没更新**，导入器正常轮询跳过）；
   - 已向用户提议（**未定**）：把标签改为只显示 addon 通道时间 / 标明通道来源，避免误读。
3. **网页性能优化已完成（见 6.5）**：`src/lib/repositories.ts`、`src/lib/ladders.ts`、`src/app/api/market/route.ts` 已改，**未提交未推送**，等待用户指示。
4. 无其他进行中的任务。

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
- AHL1 价目表格式（ahledger.com/developers）：header `AHL1|market|unixtime|rowCount`，行 `itemId:median:minBuyout:quantity:median7d:median30d:low30d:high30d`。

## 9. 用户偏好 / 协作纪律

- **回复用中文**；称呼、语气自然。
- **git**：不主动提交/推送；只有用户明确说"推/推一版"才 push；只提交点名范围；用户工作区常有大堆未提交 WIP，保持原样。
- 网页/数据库等长期运行服务都在本机跑着（见第 4 节），改动后注意别重启/杀错进程。
- 游戏内改动部署到游戏目录后要提示用户 /reload 生效。

## 10. 下一步常见场景速查（给下一个 AI）

- **用户说"网页没更新/数据更新于 X 前"** → 先查：SV 文件 scannedAt 与 LastWriteTime、`.watch-state.json`、
  DB `MAX(timestamp) GROUP BY source`、AHledger 站点当前 observedAt。结论几乎总是"游戏没落盘"或"站点没更新"，按第 7 节答复。
- **动插件逻辑** → 读 `addon\WoWderhoiAH\` 对应 .lua；测试改 `addon\test\`（桥/桩：wow-lua.ts、wow-stub.lua）；改完跑 vitest + tsc，复制到游戏目录并比对哈希。
- **动网页** → 读 `src\lib\` + `src\app\` 对应文件；页面/组件改动跑 tsc；DB 结构改动需注意 prisma/dev.db 与 schema 一致性。
- **查账本** → `GET http://localhost:3000/api/import/ledger`。
