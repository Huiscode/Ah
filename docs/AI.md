# AH 项目 AI 交接文档（docs/AI.md）

> **新 AI 接手先读本文件**（唯一交接文档，2026-11-14 由 HANDOFF.md + PRODUCT.md 合并精简而成，并更新到当前状态）。
> 最后更新：2026-11-20（WAH 模块拆成旁挂插件、Auctionator 恢复原版；中立市场识别重写；补档提速；雷达重构为四策略 + 总利润）。

## 1. 一句话：这是什么

WoW 官方"无限版"（WoW Forever / Infinite，camelot 变体，客户端 1.60.1 / build 16001）的**拍卖行行情终端**：游戏内原版 Auctionator + 旁挂插件 WoWderhoiAH-Transcript 扫描拍卖行 → SavedVariables 落盘 → 本地 Node 脚本导入 SQLite → 本地网页（Next.js 16）展示行情、捡漏雷达、配方利润、分解套利、购物清单。

**核心闭环**：游戏内扫完 → 手动 `/reload`（或登出）→ 存档写盘 → `npm run watch`（常驻自动导入）→ 网页更新。**网页只能看到已落盘的数据**——"网页没更新"十有八九是"游戏没落盘"。

## 2. 环境与关键路径

| 项 | 值 |
|---|---|
| 项目根 | `C:\Users\Hui\Documents\Workspace\Ah`（GitHub `github.com/Huiscode/Ah.git`，分支 main；**用户曾从 `Hz` 配置迁移到 `Hui`**，2026-11-14 因此丢过 Node/Git 的 PATH——Node 已用 winget 重装 LTS，系统 git 二进制目前没有装，ZCode 内置 git 可用） |
| 真实 DB | `prisma\dev.db`（**根目录 `dev.db` 是 0 字节陷阱**） |
| 游戏客户端 | `C:\Program Files (x86)\WoW_eu\_forever_\`（欧服英文原版客户端） |
| 插件（游戏内） | **两个插件**（2026-11-20 拆分）：① `AddOns\Auctionator\` = **原版 Auctionator**，直接用 CurseForge/WowUp 更新，不再改它；仓库 `addon-auctionator\` 只是原版备份（`npm run addon:deploy -- -WithAuctionator` 时才同步）。② `AddOns\WoWderhoiAH-Transcript\` = 本项目旁挂插件（仓库 `addon-wah\WoWderhoiAH-Transcript\`），`## Dependencies: Auctionator`，运行时挂钩：扫描按钮按市场路由、价格写入按市场分槽、连续扫描、扫描完成自动补档、商人价。登录自检：Auctionator 升级导致挂点缺失时聊天框报警。部署：`npm run addon:deploy` |
| 插件 SV 存档 | `...\SavedVariables\Auctionator.lua`（价格库：联盟槽 `PvP` + 中立槽 `PvP_N`）；`...\SavedVariables\WoWderhoiAH-Transcript.lua`（WAH*：前五档/商人价/扫描时间。2026-10-15~11-20 曾寄存在 Auctionator.lua，`addon:deploy` 首次运行自动迁移；`resolveTranscriptSvPath` 兼容旧 .env 指向 Auctionator.lua） |
| 服务器 | **欧服单服**（`AQ_SERVER_KEY=eu`；曾支持 eu/cn 双服，2026-11-08 国服客户端删除后收回单服——DB 的 server 列与查询签名保留恒为 "eu"，重开双服可原样恢复） |
| 一键启停 | `Ah_Start.bat` / `Ah_Stop.bat` → `scripts\launch-services.ps1`（起 web:3000 + 常驻导入，隐藏窗口、日志在 `logs\`） |
| 技术栈 | Next.js 16 App Router + Tailwind；Prisma + SQLite；Node + tsx；vitest；fengari（Lua 存档解析） |

## 3. 数据链路

| source | 内容 | 角色 |
|---|---|---|
| `transcript` | 前五档（旁挂插件逐物品搜索，`WAHTranscribeDB.markets[faction/neutral]`，每市场分开） | 档位主源（当前价/在售量，含钓单过滤；雷达按真实档位算可买量） |
| `auctionator` | Auctionator 存档聚合价（m/l/h/a + 7 日 daily） | transcript 缺失时回退 + 历史参照（**当前主力**） |
| foreverchanges.pro | 物品/配方/NPC 卖价网站（zh-cn = 中文页，根路径 = 英文页） | vendor 价唯一权威（游戏内实时值 > 网站）；物品名/英文名/ilvl 回填源 |

```
游戏内「完整扫描」（市场自动识别：联盟 → PvP 槽，中立 → PvP_N 槽）→ 自动补档前五档 → 提示手动 /reload
  ▼ 存档写盘 Auctionator.lua + WoWderhoiAH-Transcript.lua
npm run watch（scripts/watch-auto-import.ts，2 秒轮询 mtime）
  ├ auctionator:import  # 解码（ASCII 转义/CBOR/明文 Lua 表三层）→ AuctionSnapshot + DailySummary
  ├ transcript:import   # fengari 执行存档 → AuctionTier 档位（v1/v2 布局都认，按市场分流）
  ├ vendor:import       # 游戏内实时商人价（WAHVendorDB）→ Item.vendorPrice/sellPrice（全局不分服）
  └ gen:tierlist        # 补档清单下发：中间材料 + 两市场雷达候选前 150 → addon-wah\...\TierList.lua（gitignore）
                        # 并复制到游戏 AddOns\WoWderhoiAH-Transcript\；插件扫描后只搜这份清单（∩在售∩4h 新鲜度）
  ▼ SQLite（prisma\dev.db）
网页（首页 / 单品 /recipes /lists /tools/disenchant-calc；?market=neutral 切中立）
```

网页**双语（2026-11-14）**：**英文默认**，页头 `EN | 中文` 切换（cookie `wah_lang` + `router.refresh()`，服务端组件 `getLang()`、客户端 `useLang()/useLL()`，文案内联 `L(lang, "EN", "中文")`，无集中字典）。**物品名**：`Item.name` 中文 + `Item.nameEn` 英文（`scripts/backfill-item-names-en.ts` 抓 foreverchanges 英文页回填，断点续跑幂等），显示用 `displayName(name, nameEn, lang)`——EN 模式优先英文名缺失回退中文；**复制到游戏 Auctionator 的清单/搜索词跟随显示语言**（欧服英文客户端需要英文名才能命中）。品类下拉分组令牌固定英文（`Equipment`/`Materials`），market-filter 兼容映射旧中文值。**未双语的数据**：配方名/材料名/食物效果文案仍是中文（foreverchanges 中文源抓取；如需英文后续同样方式回填）。

## 4. 网页功能地图

- **首页**：机会总览三榜页签（捡漏 Deals / 异动 Movers / 分解 Disenchant；原"可做差价"已并入捡漏的"波段"策略）+ 市场监控表（区间列 BUY/SELL/FLAT）+ 右列中间材料利润/关注配方/关注物品
- **雷达设置**：筛选类（策略/品类/总利润/高流通/在售量/档位差距）localStorage 即时生效；进池条件（必赚总利润/扫货单件/单件比例/扫货总利润/最少历史/可信度，UI 以银为单位）600ms 防抖 POST `/api/radar-rules`
- **单品页** `/items/[itemId]`：收盘走势/K 线/星期季节性/价格档位/制作配方
- **配方库** `/recipes`：全量配方利润、商人青睐兑换、收藏、技能等级过滤
- **购物清单** `/lists`：数据库版清单，一键复制 Auctionator 导入文本（`清单名^物品^物品`，清单名 = 前缀+月日时分唯一防覆盖）
- **分解计算器** `/tools/disenchant-calc`：自由选材料+批量买入 g/s/c 记账
- **复制清单上限 100 条**（无限版解析过多触发 Lua 错误风暴）

## 5. 拍板口径（勿擅改）

- **当前价 = 最低买入价**（Auctionator m）；有 transcript 档位时用钓单过滤后有效最低价（tier-filter：断层且组量 < 下一档×0.5 剔除；极低价绝不剔）
- **雷达（2026-11-20 用户拍板"完整版"）**：每行是一个可执行动作，按**总利润 = 单件 × 可买量**进池与排序；有前五档时按真实档位"扫货"（逐个试买前 k 档，取总利润最大且最贵一件仍达标的方案），无档位时可买量按 1、只校验单件门槛。四策略：**必赚**（买下所有低于 NPC 收购价的档位，总利润 ≥ 10 银，无历史要求）；**扫货**（7 日参考可信：≥ 3 天、≥ 2 不同收盘；回挂价 = min(下一档 −1 铜, med7)；单件 ≥ max(20 银, 买价 15%)，总利润 ≥ 1 金）；**跨市场**（这里买 → 另一市场最低价 −1 铜挂出，两边数据都 ≤ 48 小时，门槛同扫货）；**波段**（原可做差价：高波动×需求广×有货且跌破 7 日带下沿，回到 med7 卖）。RadarRule 存档带 `version`，口径升级后旧保存值整体作废（`RADAR_RULES_VERSION`）
- **med7** = 近 7 日同源每日收盘中位数（绝不含 addon 旧源）
- **vendor 权威**：游戏内实时商人价 > foreverchanges 无限服版卖价 > ~~Auctionator 缓存（已弃用，系统性失真）~~
- **流通分** = 下游配方数（turnoverScore），非在售量
- **分解榜硬门槛**：主档（约 75% 概率组）较好结果到手 ≥ 买入价才入选，抽奖型直接过滤
- **7 日带**：近 7 日同源收盘 min/max 近似 P10/P90；跌破下沿=买入区，冲穿上沿=卖出区
- **配方成本兜底**：材料成本优先 NPC 卖价（sellPrice）；成品兜底收购价；用了兜底必须标 "NPC"
- **AH_CUT = 5%**
- **双市场**（联盟 PvP / 中立 PvP_N）数据分槽严禁混槽（扫描与出售页顺带写价都按当前拍卖行市场路由）；**单扫描按钮**，市场识别顺序（2026-11-20 重写，原纯区域白名单在中立拍卖行返回 nil 导致按钮变灰）：`/wahmarket faction|neutral` 手动指定 → 联盟主城（区域名/mapID）→ 拍卖师是中立阵营（地精等）→ 中立区域白名单（艾尔文森林/赤脊山 + 加基森/藏宝海湾/永望镇所在区域）→ 否则未知：禁用按钮并在聊天框打印区域/子区域/拍卖师阵营/mapID 诊断（宁可不扫不误判）

## 6. 血泪坑（防止重蹈）

1. **扫描引擎**：replicate 全量扫描在无限版有 15 分钟硬冷却+10% 停顿 → 已切换**增量扫描（SendBrowseQuery 逐页）**为实际引擎（逐页扫全部挂单=事实上的全量覆盖），平滑无限重扫是用户核心诉求；浏览结果只有每物品最低价+总量，前五档只能逐物品 SendSearchQuery 补；自动补档候选的天数键兼容字符串（Auctionator `tostring(GetScanDay())`，2026-11-15 修），**勿改回**
   - **补档慢的历史根因（2026-11-20 修）**：`StartTierBackfill` 调用了文件后面才定义的 `local advance` → 调用 nil，自动补档从未成功，且残留 `running=true` 让之后每次都跳过；被限流的查询静默丢弃、干等 8 秒超时。现为 OnUpdate 队列：发送前查 `IsThrottledMessageSystemReady`、超时 4 秒重试 1 次、只认当前物品的结果事件、按单价升序搜索
   - **SavedVariables 在插件文件执行完之后才载入**：文件顶层 `X = X or {}` 会被存档整体替换、局部变量会指向旧表 → 初始化一律挂 `WAH.OnSavedVariablesLoaded`
2. **无限版禁止插件调用 ReloadUI**（黄字+不执行+不落盘，实证）→ 自动重载废弃，扫描完成只提示用户手动 `/reload`
3. **taint**：EventBus 回调链内严禁 chat()/AddMessage/ReloadUI——listener 只做纯赋值，操作放独立 OnUpdate 帧
4. **CBOR 坑**：Auctionator 启动后 `C_Timer.After(0)` 会把非当前服表槽编码成 CBOR 字符串（每次登录一个槽，原版行为，不再改 Auctionator 排除 `PvP_N`）→ 旁挂插件 `WAH.GetDatabaseNeutral` 懒建时先解码、槽被替换时重建实例；导入端两种格式都认
5. **Auctionator.lua 解析三坑**：大括号配对提取顶层块 / fengari 必须 `lua_tojsstring`（`lua_tostring` 返回 Uint8Array）/ 支持明文 Lua 表槽（latin1 字节保真 + `\DDD` 转义 + CBOR byte-string 键）
6. **AH 残留旧价**：物品本次扫描无在售时 Auctionator 保留旧 m → 导入按"扫描日无在售 → price=0"，0 价不进市场/雷达
7. **扫描时间戳必须 `time()` Unix 秒**（勿用 `GetTime()` 相对秒——曾致"20741 天前"）；每市场独立（`WAHScanTimes`）
8. **GameTooltip nil 弹窗**是无限版原生 bug：`/console scriptErrors 0` 会话级关闭
9. **foreverchanges 限流**：批量抓 403 → 限速（英文名回填 250ms/条）+ 退避；断点续跑
10. **Prisma DLL 锁**：web/watch 占用时 `prisma generate` 报 EPERM → 先停占用；**Next 旧 chunk 残留**（单页 500）→ 删 `.next` 重建
11. **前缀物品**：随机前缀（孤狼之…/…of the Bear）同 itemId，AH 按基础名搜索；`baseNameOf` 中文剥"之"前缀、英文剥 "of the …" 后缀
12. **Windows PowerShell 5.1 陷阱（2026-11-14 实证）**：`Get-Content -Raw`/`WriteAllText` 对无 BOM UTF-8 默认按 ANSI 读写 → **中文注释被毁**（当时靠 git blob 手工恢复）。改文件一律用编辑器工具或明确 `[IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)`；PS5.1 无三元运算符

## 7. 用户偏好 / 协作纪律

- **回复用中文**；称呼语气自然
- **git**：不主动提交/推送；"提交 git"才 commit、"推/推一版"才 push；只提交点名范围
- **网页等长期服务在本机跑着**：改动后别重启/杀错进程；`npm run watch` 是唯一同步入口
- **服务启动**：用 `C:\Program Files\nodejs\node.exe`（标准 winget/MSI 安装位置；勿用沙箱版 node）
- **清空运行时数据**（SQLite + SavedVariables + 导入进度）：由用户通知触发，代码/git 保留；清空后需重跑 `npx tsx scripts/backfill-item-level.ts`（删 `scripts/.ilvl-progress.json` 从头抓）+ `npm run names:en`（英文名同理删 `.names-en-progress.json`）

## 8. 常用命令 / 故障速查

```
cd C:\Users\Hui\Documents\Workspace\Ah
npx tsc --noEmit && npx vitest run    # 类型 + 全量测试（2026-11-14：23 文件 189 用例全过）
npm run watch                          # 常驻自动导入（唯一同步入口）
npm run auctionator:import             # 手动导入（幂等）
npm run names:en                       # 英文名回填（断点续跑，~9800 件）
npx tsx scripts/backfill-item-level.ts # ilvl 回填（分解榜依赖）
# 改插件：只改 addon-wah\WoWderhoiAH-Transcript\（不要再改 addon-auctionator\）→ lua 语法检查
#         （node scripts\lua-syntax-check.cjs <file>）→ npm run addon:deploy → 用户 /reload（新插件首次需重启客户端）
npm run addon:deploy                   # 同步旁挂插件到游戏；检测到旧版改造 Auctionator 时自动换回原版并迁移 WAH* 存档（需关游戏）
```

- **两台电脑同步**：这边改完推 git → 另一台 `git pull` → `npm install` → `npm run db:push`（只补表/字段，不清数据）→ `npm run addon:deploy` → 重启服务。`prisma\dev.db`、`.env`、`TierList.lua` 都不在 git 里，pull 不会动它们

- **"Ah_Start.bat 起不来"** → 看 `logs\web.*.log`；2026-11-14 一次是换用户配置（Hz→Hui）导致 Node 整个丢失，winget 重装 `OpenJS.NodeJS.LTS` 解决
- **"网页没更新"** → 查存档 LastWriteTime + DB `MAX(timestamp)`——几乎总是"游戏没 /reload 落盘"
- **"某物品没价格"** → 未被扫描到；"NPC 价格不对" → vendor 权威：游戏内实时 > 网站
