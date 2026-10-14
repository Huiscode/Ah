# AH 项目跟进文件（HANDOFF · v2）

> **进入本项目的唯一必读入口**：先读本文件，再按需精读具体代码，不要通读整个仓库。
> 最后更新：2026-10-14（本地 UTC+2）。对应 git HEAD：`662d3bf`（M3+M4 首推，已推送）。
> **v2 说明**：2026-10-13 起数据源已从自研插件切换为 Auctionator + M4 转录插件；旧自研插件
> 时代的一切历史记录（P10/P50、中立市场、账本、旧扫描链路等）**已全部失效**，本版不再保留。
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
| foreverchanges.pro | 物品/配方/NPC 卖价的**游戏内确认权威**（网站） | vendor 价、物品名、配方（M1b 待正式抓取；vendor 已先行用实测修正） |

```
游戏内 Auctionator（扫描 → 聚合价 m/l/h/a 落盘）
   │  登出 / /reload 才写盘 → Auctionator.lua
   ▼
npm run auctionator:import        # 解码（ASCII 转义+CBOR）→ 快照 + DailySummary（source='auctionator'）
                                  # 【v2】不再写 Item.vendorPrice（VENDOR_PRICE_CACHE 失真，见 §5-7）

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
| 共享解码 | `src\lib\auctionator-sv.ts`（readAuctionatorSavedVars / CBOR / Lua 转义） |
| 档位过滤公式 | `src\lib\tier-filter.ts`（13 测试） |
| 极少挂单剔除 | `src\lib\bait-filter.ts`（markBaitDays / markThinDays） |
| 查询层 / 信号 / 雷达 | `src\lib\repositories.ts`（mode 分叉）、`analytics.ts`、`market-signals.ts`（快照代+mode 缓存）、`market-rules.ts`（雷达阈值） |
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
- **雷达**：`必赚` = 当前最低买入价 < NPC 卖价（**不需要历史**）；`捡漏` = med7Samples≥3 天、折扣≤85%
  med7、最低盈利≥30 铜、比例≥25% 等（阈值全在 `market-rules.ts`）。
- **vendor（NPC 卖价）权威 = foreverchanges.pro 实测**（游戏内确认）；Auctionator 缓存已弃用（见 §5-7）。
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
   修复后雷达 500 条（必赚 89 + 捡漏 411，当时口径）。
5. **source 隔离**：`buildMarketSignal` 不按模式过滤快照源 → 当前模式混入 addon 老数据（如草莓汁
   10-06 价被当"当前价"推进必赚）→ 改为 history 只用 addon、current 排除 addon；查询层
   getMarketUniverse / getItemDetail / med7 SQL 均排除 addon。
6. **med7 虚标**：getMed7Aggregates 按"最新 daily 选源"把 addon 10-09 行误选为参考源（墨水 7 日参考
   虚标 74 铜）→ SQL 排除 addon，只算真实源。
7. **VENDOR_PRICE_CACHE 失真（墨水 20 金事件）**：DB 墨水 vendor=200000 铜（20 金）→ 用户质疑 → 与
   foreverchanges 交叉验证：墨水真 5 银、树干 5 银、星木 11 银 25 铜、结构图 30 银、粗原木 5 金，
   **全部与缓存不符**（缓存普遍 = 真实铜价 ×4 上下，倍数因物品而异）。源码确认该缓存是**玩家打开
   NPC 商人时** `GetMerchantItemInfo` 总价 ÷ 组数量的实测记录（CraftingInfo 制造利润模块用），
   Forever 私服该 API 语义与官方不同 → 系统性失真；我们的 M1 又按"银"×100 解读，错误叠错误。
   **修复**：① 必赚区 72 个物品 vendorPrice 用 foreverchanges 实测价覆盖（必赚 89 → 23 条，清掉
   66 条假必赚）；② `auctionator-import.ts` 弃用 VENDOR_PRICE_CACHE（防止下次导入写回错值）。
8. **捡漏 411 → 0 是正确行为**：addon 隔离后捡漏只看 Auctionator 真实数据，而多数物品只有 1 天历史
   （1天 2768 / 2天 435 / 3天 2）→ 3 天门槛挡住。**连续扫几天后自然充实**（与老插件"积累几天才有
   捡漏"一致）。

## 6. 数据现状（2026-10-14）

- AuctionSnapshot：addon 473,663 / auctionator 3,519~3,520
- DailySummary：addon 47,606 / auctionator 6,771 / transcript 48（10-14 首轮 1 天）
- AuctionTier：transcript 254 档 / 48 物品（首轮，未覆盖全量）
- Item：5,445 + 65 占位；当前信号 3,521（无 addon）
- 雷达：必赚 **23**（vendor 修正后）/ 捡漏 ~0（天数不足，待积累）

## 7. 待办 / 未完成（按优先级）

1. **转录全量重扫**（M4 落地关键）：用户游戏内开拍卖行 → `/wahscan start`（3577 物品约 36 分钟）→
   登出 → `npm run transcript:import`（先删后插，会覆盖现有 48 物品数据）。
2. **M1b foreverchanges.pro 数据源**：物品/配方/vendor 全量抓取（限速）；配方缺货标注已做；用户会
   定期让扫新增可赚金币内容。vendor 权威已先行确认（§5-7），剩约 1,187 个疑似失真 vendor 待全量校准。
3. **POSTING_HISTORY**：当前为空（`{__dbversion=1}`），`PostingRecord` 表已建、解析口子就绪。
4. **小飞刀 2947**：foreverchanges 限流未抓到（403），待补（真价 ≈3.5 铜，缓存 14 银失真）。
5. **开服清空运行时数据**（SQLite + SavedVariables + 导入进度；代码/git 保留），由用户通知触发。

## 8. git 状态

- HEAD = origin/main = `662d3bf`（M3+M4 首推，含 HANDOFF M4 章节）。
- **未提交**：M4e 全部修复——雷达并集 + freshness 7 天、source 隔离、med7 排除 addon、vendor 修正
  72 条、auctionator-import 弃用 VENDOR_PRICE_CACHE。
- 纪律：**只有用户明确说"推/推一版"才 push；说"提交git"才 commit**；只提交点名范围。

## 9. 已知坑 / 机制限制

- **SV 落盘时机**：登出 / /reload 才写盘；游戏内扫完必须 /reload 或登出再导入。
- **Auctionator.lua 解码三坑**（`auctionator-sv.ts` 已处理）：ASCII 转义 + 原始二进制混合 → 字节保真
  读（latin1）；Lua `\DDD` 十进制转义；CBOR byte-string 键 → Map 递归转对象。
- **Auctionator 无 P10/ladder/挂单数**：当前口径 = 最低买入价 m；档位只有 transcript 有。
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
npx tsc --noEmit && npx vitest run   # 类型检查 + 全量测试（154 用例）
npm run build                        # 生产构建
npm run auctionator:import           # 聚合价导入（幂等；不再写 vendor）
npm run transcript:import            # 档位导入（幂等，先删后插，覆盖现有 transcript）
node -e "const{DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('prisma/dev.db');console.log(JSON.stringify(db.prepare('SELECT source,COUNT(*) n,MAX(timestamp) latest FROM AuctionSnapshot GROUP BY source').all()))"
```

- **"网页没更新"** → 先查 Auctionator SV 的 LastWriteTime 和 DB `MAX(timestamp) GROUP BY source`；
  结论几乎总是"游戏没落盘"→ 让用户 /reload 或登出再导入。
- **"XX 物品没名字/没价格"** → 名字缺失 = foreverchanges 未抓（M1b 待做）；价格缺失 = 未被扫描到；
  配方页标"缺货"。
- **雷达条数异常** → 先分模式：current 只看最新轮在售物品；阈值在 `market-rules.ts`；捡漏需要
  med7Samples≥3 天（数据未积累时为 0 是正常的）。
- **改查询/口径** → `repositories.ts`（mode 分叉）→ `analytics.ts`（buildMarketSignal）→
  `market-signals.ts`（缓存 key = mode:latestSnapshotAt:metaVersion）；页面层 `src\app\page.tsx`、
  `items\[itemId]\page.tsx`（history 开关）。

## 11. 用户偏好 / 协作纪律

- **回复用中文**；称呼、语气自然。
- **git**：不主动提交/推送；用户说"推/推一版"才 push，"提交git"才 commit。
- **公测清空（偏好）**：用户通知"公测开始"时清空全部运行时数据（网页 SQLite + 插件 SavedVariables +
  导入进度），代码与 git 保留；清空后历史模式仍可参考旧 P10 曲线，之后可删。
- 网页等长期服务在本机跑着，改动后别重启/杀错进程；导入数据是手动脚本，无常驻 watcher。
