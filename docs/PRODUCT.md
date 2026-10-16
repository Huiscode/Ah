# AH 项目产品说明（PRODUCT.md）

> **供新 AI 接手前阅读的产品全貌**：讲清"这是什么、怎么运转、有哪些拍板口径、哪些是血泪结论"。
> 交接清单（当前状态 / 待办 / 坑）见 `HANDOFF.md`；本文件与 `HANDOFF.md` 配合使用，先读本文件建立心智模型，再读 HANDOFF 拿当前状态。
> 最后更新：2026-10-16（双市场 + 转录并入 + 扫描引擎切换全链路落地后）。

---

## 1. 产品概述

**一句话**：WoW 官方"无限版"客户端（camelot 变体，客户端 1.60.1 / build 16001）的**拍卖行行情工具**——游戏内 Auctionator 插件扫描拍卖行 → SavedVariables 落盘 → 本地 Node 脚本导入 SQLite → 本地网页终端展示行情、捡漏雷达、配方利润、历史参考。

- 游戏目录：`C:\Program Files (x86)\World of Warcraft\_classic_beta_\`（**非私服**，官方无限版）
- 项目根：`C:\Users\Hz\Documents\Workspace\Ah`（仓库 `github.com/Huiscode/Ah.git`，分支 main）
- 技术栈：Next.js App Router + Tailwind（网页）；Prisma + SQLite（数据）；Node + tsx（导入脚本）；vitest（测试）；fengari（Lua 存档解析）

**核心闭环**：游戏内扫完 → 手动 `/reload`（或登出）→ 存档写盘 → 常驻自动导入（`npm run watch`）→ 网页自动更新。**网页只能看到已落盘数据**——"网页没更新"十有八九是"游戏没落盘"。

---

## 2. 游戏内插件（Auctionator 改造版）

- **游戏内实际加载**：`...\_classic_beta_\Interface\AddOns\Auctionator\`（toc 允许 camelot 加载）
- **仓库受控副本（唯一改插件入口）**：`addon-auctionator\`——**先改副本，再用 robocopy 同步游戏目录**（升级 Auctionator 官方版会覆盖自改代码，靠受控副本 diff 重打）
- **双市场改造（核心特性，用户拍板）**：
  - 全量扫描按钮拆成「扫描联盟拍卖行」「扫描中立拍卖行」两个
  - 打开拍卖行时按**区域地点**自动判定市场（`Source_Forever\Market.lua` 的 `GetRealZoneText()` 白名单：联盟 = 暴风城/铁炉堡/达纳苏斯，中立 = 艾尔文森林/赤脊山，中英文都收），**只启用对应按钮**；未知区域两钮禁用。**判定只用地点，无挂单量回退**（宁可不扫不误判）
  - **数据严格分槽**：联盟 → `AUCTIONATOR_PRICE_DATABASE["PvP"]`；中立 → `["PvP_N"]`（`Source_Forever\DatabaseNeutral.lua` + 扫描 `EndProcessing`/`NextStep` 按 `CurrentScanMarket` 路由）。**两市场数据严禁混槽**，从落盘起就不在同一槽
- **扫描引擎（当前实际生效）**：按钮优先走 **IncrementalScan（增量扫描，`SendBrowseQuery` 逐页浏览）**——进度 0-100% 平滑、**无 15 分钟冷却、可无限重扫**、中立拍卖行同样可用。replicate 全量扫描（ModernAH FullScan）有 15 分钟硬冷却 + 10% 停顿，已降级为增量引擎不可用时的回退
- **转录功能并入**（`Source_Forever\`：Transcript.lua + VendorPrice.lua + AutoReload.lua，独立插件目录已删除，存档全局名不变）：
  - `/wahscan start` 逐物品读完整价格档位 → `WAHTranscribeDB`（档位主源）
  - 打开商人窗口自动记录收购价/卖出单价 → `WAHVendorDB`（vendor 权威源）
  - AutoReload：扫描完成提示落盘（详见 §5 自动重载结论）
- **存档文件**：`...\WTF\Account\1120133458#1\SavedVariables\Auctionator.lua`（含 PvP / PvP_N / WAH* 全部数据；旧转录独立存档已合并，`.manual-merge.bak` 备份）

---

## 3. 数据链路

**四种数据源并存，靠 `source` 列区分**：

| source | 内容 | 角色 |
|---|---|---|
| `transcript` | M4 转录插件，完整价格档位 | 档位主源（当前价/在售量） |
| `auctionator` | Auctionator 存档，聚合价（m/l/h/a + 7 日 daily） | transcript 缺失时回退 + 历史参照 |
| `addon` | 旧自研插件删档数据（47 万行 P10，截至 10-06） | **仅历史模式**（`?history=1`） |
| foreverchanges.pro | 物品/配方/NPC 卖价网站 | vendor 价唯一权威（游戏内值 > 网站） |

```
游戏内插件扫描（联盟 PvP / 中立 PvP_N 分槽）
  │  手动 /reload 或登出 → 写盘 Auctionator.lua（WAH* 同文件）
  ▼
npm run auctionator:import   # 解码（ASCII/CBOR/明文 Lua 表）→ 快照 + DailySummary（market 列隔离）
npm run transcript:import    # fengari 执行存档 → AuctionTier 档位 + tier-filter 聚合
npm run vendor:import        # 游戏内实时商人价 → Item.vendorPrice / sellPrice
  ▼
SQLite（prisma\dev.db——根目录 dev.db 是 0 字节陷阱）
  ▼
网页（首页 / 单品页 / 配方页 / 清单页 / 雷达；当前 + 历史两模式；联盟 + ?market=neutral 同页切换）
```

**常驻自动导入**：`npm run watch`（`scripts\watch-auto-import.ts`）每 2 秒 stat 存档 mtime，扫描落盘后自动依次跑三个导入（失败不崩、继续监视）。一键启停：`WAH一键启动.bat` / `WAH一键停止.bat`（`scripts\launch-services.ps1`）。

---

## 4. 网页功能

- **首页**：当前行情列表（最低买入价、med7 参考、走势）、捡漏雷达、必赚区、关注物品、价格下限筛选（localStorage）
- **单品页**：`/items/[itemId]`——当前价/历史/走势/配方引用
- **配方库**：`/recipes`——配方利润、材料成本、商人青睐图纸、附魔效果（cost-only）、图纸 AH 价值标注
- **购物清单**：`/lists`——数据库版清单（ShoppingList 表），雷达/关注/配方一键加入、粘贴导入回存
- **市场切换**：首页/单品页支持 `?market=neutral` 同页切换（默认联盟；雷达/必赚默认只看联盟）；`?history=1` 历史模式（addon P10）
- **雷达设置**：`/api/radar-rules` + 设置面板（最低盈利/最少历史/可信度/新鲜度窗口 + 价格下限）

---

## 5. 关键口径（用户拍板，勿擅改）

- **当前价 = 最低买入价**；有 transcript 档位时用档位过滤后的有效最低价
- **档位过滤**（`tier-filter.ts`）：升序档位分组，断层且组量 < 下一档量×0.5 → 整组剔除（钓单防护）；极低价绝不剔（= 捡漏机会）
- **雷达**：`必赚` = 最低买入价 < NPC 卖价（无门槛）；`捡漏` = 最低盈利 ≥ 50 铜 + 最少历史 ≥ 2 天 + 可信度 ≥ 2 + 新鲜度 7 天（全部网页可调）；深折扣一律视为机会（无折扣线/供应上限门槛）
- **vendor 权威顺序**：游戏内实时商人价（WAHVendorDB）> foreverchanges.pro 无限服（FOREVER BETA it-add 版）卖价 > Auctionator 缓存（**已弃用，系统性失真**）
- **配方成本兜底**：材料成本优先 NPC 卖价（`sellPrice`），成品收入兜底 = 收购价；用了兜底百分比后必须标 "NPC"
- **双市场**：数据分槽严禁混槽；判定只用地点白名单；转录档位只有联盟数据，中立市场不参与档位合成
- **网页数据新鲜度（v3.8）**：快照时间戳按市场独立（`WAHScanTimes`，插件扫描完成写入 `time()` Unix 秒——**勿用 `GetTime()` 相对秒**，曾致"20741 天前"）；扫中立不再误报联盟"刚刚"

---

## 6. 重要结论（血泪教训，防止重蹈）

1. **扫描引擎**：replicate 全量扫描在本服（官方无限版）有 15 分钟硬冷却、10% 停顿、连扫卡死 → **已切换增量扫描（逐页浏览）为实际引擎**：平滑、无冷却、无限重扫。这是用户核心诉求（对标 AUC 体验），勿改回
2. **无限版禁止插件调用 ReloadUI**（2026-10-16 实证）：拍卖行开/关任何上下文都黄字"插件导致界面行为失效"且**不执行、数据不落盘**（存档时间戳验证）；taint.log 为空（非污染）。→ **自动重载方案废弃，改为扫描完成提示用户手动 /reload**（原生命令必落盘）；提示默认静默（`/wahvendor reload on` 可开）
3. **CBOR 编码坑**：Auctionator 启动后 `C_Timer.After(0)` 会把非当前服务器表槽编码成 CBOR 字符串——中立槽 PvP_N 曾被编码 → 游戏侧扫描对字符串写 → 错误风暴。已修：`Source\Variables\Main.lua` 串行化循环排除 `PvP_N`；`DatabaseNeutral` 懒建时先 `DeserializeCBOR` 解码
4. **网页解析器三层坑**（`src\lib\auctionator-sv.ts`）：① 顶层块提取必须**大括号配对扫描**（明文多行表闭括号在行首，`^}` 正则会提前截断）；② fengari 字符串必须 `lua_tojsstring`（`lua_tostring` 返回 Uint8Array）；③ 支持明文 Lua 表槽解析（`extractTableField` + fengari 求值）
5. **GameTooltip nil 弹窗**（`GameTooltip_SetDefaultAnchor`）：无限版客户端原生 bug（错误栈无插件代码；Auctionator 对 tooltip 只用安全 hooksecurefunc）→ 非插件问题，`/console scriptErrors 0` 关闭弹窗（**会话级，游戏内显式执行**；Config.wtf 写入会被游戏写回覆盖，不可靠）
6. **taint 污染教训**：EventBus 回调链（可能是受保护链）内**严禁 chat()/AddMessage**（无限版把聊天缓冲 ScrollingMessageFrame/SecureTypes 纳入受保护，链内 AddMessage 污染 SecureTypes、连带 ReloadUI 被阻止）——listener 只做纯状态赋值，chat/操作全放独立 OnUpdate 帧
7. **vendor 失真**：Auctionator 的 `VENDOR_PRICE_CACHE` 是买价÷组数，系统性失真（墨水 20 金假价事件）→ 导入弃用该缓存，vendor 以游戏内实时价/网站无限服版为准
8. **AH 残留旧价**：物品本次扫描无在售时 Auctionator 保留旧 m → 导入须按"扫描日无在售 → price=0"处理（`latestSeenDayOf`），0 价不进市场/雷达/配方
9. **前缀物品**：随机前缀（孤狼之/猎鹰之…）是同一 itemId，AH 按基础名搜索/挂单（"轻身法杖"），搜索用基础名

---

## 7. 已知限制 / 坑

- **SV 落盘时机**：登出或 `/reload` 才写盘；游戏内扫完必须 reload 或登出再导入
- **Auctionator.lua 解码**：ASCII 转义 + 原始二进制混合 → latin1 字节保真读；Lua `\DDD` 转义；CBOR byte-string 键
- **foreverchanges.pro 限流**：批量抓取 403 → 限速 2.5s+ + 退避；只能逐条抓
- **Prisma DLL 锁**：后台 audit 占用时 `npm run build` 的 prisma generate 会 EPERM → 先停 audit 再 build
- **Next 增量构建旧 chunk 残留**（单页 500）：删 `.next` 后全量重建
- **真实 DB 是 `prisma\dev.db`**；根目录 `dev.db`（0 字节）是陷阱
- **转录断点续扫实际不可续**（首轮中断需重扫）；POSTING_HISTORY 当前为空（解析口子已就绪）

---

## 8. 常用命令

```
cd C:\Users\Hz\Documents\Workspace\Ah
npx tsc --noEmit && npx vitest run   # 类型检查 + 全量测试
npm run build                        # 生产构建（先停 audit 防 Prisma DLL 锁）
npm run auctionator:import           # 聚合价导入（幂等）
npm run transcript:import            # 档位导入（幂等）
npm run vendor:import                # 游戏内实时商人价导入（幂等）
npm run watch                        # 常驻自动导入（唯一同步入口）
npm run auctionator:import           # 双槽分市场导入（联盟 PvP + 中立 PvP_N）
npx tsx scripts/vendor-price-audit.ts  # vendor 价全量核对（断点续跑）
```

**改插件流程**：改 `addon-auctionator\` → fengari 语法检查（`scripts\lua-syntax-check.cjs`）→ robocopy 同步游戏目录 → 用户 `/reload`。

---

## 9. 用户偏好 / 协作纪律

- **回复用中文**；称呼语气自然
- **git**：不主动提交/推送；用户说"推/推一版"才 push，"提交 git"才 commit
- **公测清空**：用户通知"公测开始"时清空全部运行时数据（SQLite + SavedVariables + 导入进度），代码与 git 保留，由用户通知触发
- **网页等长期服务在本机跑着**，改动后别重启/杀错进程
- **双市场判定只用地点**（用户明确反对挂单量回退）；**数据严禁混槽**
- **扫描体验对标 AUC**：平滑逐页、可无限重扫（反复强调的核心诉求）
