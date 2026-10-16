# Auctionator 扫描按钮拆分（联盟 / 中立）+ 转录插件并入・规划

> 状态：
>
> **规划定稿（未实施）**
>
> 。依据 2026-10-15 对游戏内 Auctionator 340 与仓库代码的探查。
> 三个决策点已于 2026-10-15 用户拍板：① 数据分槽一步到位；② 中立市场同页切换；③ 转录并入 + 仓库受控副本。
> 本规划只定方向与改动面，具体行级修改在实施时按本文件核对。

## 0. 探查结论（现状事实）

### 0.1 客户端与 Auctionator 实际加载形态



* 客户端：Forever 私服客户端，build 16001，`WOW_PROJECT_ID = WOW_PROJECT_CAMELOT`（`Source\Constants\Main.lua` 里 `IsForever = build>=16000 and <20000`、`IsRetail = ... or WOW_PROJECT_ID == WOW_PROJECT_CAMELOT`）；内核是零售 12.x（`C_AuctionHouse`、`plunderstormRealm` 配置都在），以 "传统拍卖行模式" 运行（`IsUsingLegacyAuctionClient()` → `IsLegacyAH=true`）。

* **在用的全量扫描 = LegacyAH 变体**：证据 ——AutoReload.lua 兜底 hook 监听事件名 `get_all_scan_complete`（`Source_LegacyAH\FullScan\Events.lua`），用户已实测生效；ModernAH 变体的事件名是 `replicate_scan_*`。

* 游戏内 UI：传统拍卖行帧（`AuctionFrame`），Auctionator 标签页 "Auctionator"（`AuctionatorConfigurationTabFrameTemplate`）。

### 0.2 全量扫描链路（当前）



```
按钮（Source\Tabs\Auctionator\Frames\Main.xml L262 ScanButton）
  → AuctionatorScanButtonMixin:OnClick（Source_LegacyAH\Tabs\Auctionator\Mixins\ScanButton.lua）
  → Auctionator.State.FullScanFrameRef:InitiateScan()
      （Source_LegacyAH\FullScan\Mixins\Frame.lua）
  → QueryAuctionItems("", nil, nil, 0, nil, nil, true, false, nil)   -- 拉取"当前打开的拍卖行"全部挂单
  → AUCTION_ITEM_LIST_UPDATE → 缓存 → MergeInfo
  → Auctionator.Database:ProcessScan(allInfo, cb)                    -- 写入价格库
  → AUCTIONATOR_PRICE_DATABASE["PvP"] 槽（realm slot）
```



* **关键事实 1**：get-all 查询永远扫 "此刻打开的拍卖行"，按钮本身不区分市场。

* **关键事实 2**：联盟主城 AH 与赤脊山中立 AH 的扫描结果**混在同一个槽** `PvP`，网页导入后 `market='faction'` 硬编码，中立价会被当成联盟价。

### 0.3 AH 类型判定（本服已有成熟方案）

旧自研插件 `archive\addon\WoWderhoiAH\WoWderhoiAH.lua`（0.3.8）在本服实测过：



* **区域白名单**：`GetRealZoneText()` 即市场标签。


  * 联盟（主城）：`暴风城 / Stormwind City`、`铁炉堡 / Ironforge`、`达纳苏斯 / Darnassus`

  * 中立（艾尔文森林 / 赤脊山交界贸易营地，即 "赤脊山的中立拍卖行"）：`艾尔文森林 / Elwynn Forest`、`赤脊山 / Redridge Mountains`

  * 同时收 zhCN + enUS 两种拼写（客户端按 `textLocale zhCN` 本地化）。

* **判定只用地点（用户拍板，2026-10-15）**：不再使用挂单量阈值回退。地点是确定性信号——联盟拍卖行只存在于主城，中立拍卖行只在艾尔文森林 / 赤脊山交界贸易营地，一一对应、互不重叠；`GetRealZoneText()` 在拍卖行面板打开时即时可用、不依赖任何扫描数据量。**未知区域 → 无法判定 → 两个扫描按钮都禁用（宁可不扫，绝不误判进错槽）**。

* 该插件把中立扫描**独立存放**（`WoWderhoiAHDB.neutralScanData`），"绝不覆盖 / 污染联盟数据"。

### 0.4 网页数据层（已为中立预留）



* `prisma\schema.prisma`：`AuctionSnapshot.market String @default("faction")`，注释原文："faction（主城阵营市场）| neutral（中立地精市场）；**中立扫描不得进入联盟分析**"；`DailySummary.market` 同样存在。

* 查询层 `src\lib\repositories.ts` 各处 `WHERE "market" = 'faction'`（当前模式）——**中立行入库后天然不会混入现有页面**。

* 导入 `scripts\auctionator-import.ts`：`MARKET="faction"` 硬编码，只读 `AQ_AUCTIONATOR_REALM_SLOT`（默认 `PvP`）一个槽；`readAuctionatorSavedVars(path, slot)` 已是槽参数化（`src\lib\auctionator-sv.ts`），换槽名即可复用。

* 历史上有过中立市场页面：`archive\pages\neutral\page.tsx`（旧系统产物，可参考）。

### 0.5 转录插件（要并入的对象）

`addon-transcript\`（游戏目录 `Interface\AddOns\WoWderhoiAH-Transcript`，v0.2.1）三个文件：



* `Transcript.lua`：`/wahscan start|stop|resume|status`，逐物品 `C_AuctionHouse.SendSearchQuery` 读完整档位 → `WAHTranscribeDB.scans[itemId]={t,tiers[]}`；只读 `AUCTIONATOR_PRICE_DATABASE` 当物品清单（不依赖 Auctionator 代码）。

* `VendorPrice.lua`：`MERCHANT_SHOW/UPDATE` → `WAHVendorDB.scans[itemId]={p,sp,t}`（p = 收购价，`C_Item.GetItemInfo` 第 11 返回；sp = 卖出单价 `GetMerchantItemInfo.price÷quantity`）。

* `AutoReload.lua`：hook `Auctionator.EventBus`（listener + Fire 兜底 `get_all_scan_complete`），扫描完成自动 `/reload` 落盘；导出 `WAHReload.schedule()` 供 Transcript 扫描完成调用；`/wahvendor reload` 命令；初始化靠 **OnUpdate 轮询**等 Auctionator 就绪。

* 依赖面极小（公共 API + Auctionator.EventBus + Auctionator.FullScan.Events），并入可行。

## 1. 目标与方案总览



| 工作块        | 目标                                           | 方案                                             |
| ---------- | -------------------------------------------- | ---------------------------------------------- |
| A 游戏内・按钮拆分 | 全量扫描钮分成 "扫描联盟拍卖行"" 扫描中立拍卖行 " 两个              | XML 双按钮 + 市场判定 + 显隐                            |
| B 游戏内・数据分槽 | 中立扫描不污染联盟行情                                  | 中立写入独立槽 `PvP_N`，EndProcessing 按市场路由            |
| C 网页端      | 中立数据正确入库、不混入联盟页面                             | 导入脚本加中立槽第二遍导入（`market='neutral'`）              |
| D 转录并入     | 删掉独立 WoWderhoiAH-Transcript，功能并入 Auctionator | 搬进 `Source_Forever\` 模块 + toc 加 SavedVariables |

> 优先级：A 是用户点名需求；B 是 A 的必要配套（否则分两个按钮没意义，数据照样混）；C 跟随 B；D 独立可选。

## 2. 详细设计

### A. 按钮拆分 + 自动判定 + 显隐

**新增市场判定模块** `Source_Forever\Market.lua`：



```
Auctionator.Forever.DetectMarket()  -- → "faction" | "neutral" | nil（纯地点判定，无任何回退）
-- 1) GetRealZoneText() 命中白名单（zhCN+enUS）→ 直接判定
--    联盟：暴风城 / 铁炉堡 / 达纳苏斯；中立：艾尔文森林 / 赤脊山（三角路口贸易营地）
-- 2) 白名单未命中 → nil（两按钮禁用，提示"无法识别拍卖行类型，请在联盟主城或中立营地打开拍卖行"）
```

**按钮改造** `Source\Tabs\Auctionator\Frames\Main.xml`（L262 起）：



* 单个 `ScanButton` 改为两个并排按钮：`ScanButton`（联盟，沿用现锚点 BOTTOMRIGHT）+ `NeutralScanButton`（中立，锚在其左侧）。

* 各自 `mixin`：`AuctionatorScanButtonMixin`（联盟）/ `AuctionatorNeutralScanButtonMixin`（中立）；`OnClick` 里先校验 `DetectMarket()` 与自身一致，一致才置 `scanMarket` 并调用 `FullScanFrameRef:InitiateScan()`。

* 状态条 `AuctionatorFullScanStatusTemplate` 保持横跨两钮上方。

* 文案：`Locales\zhCN.lua` 新增 `FULL_SCAN_BUTTON` → "扫描联盟拍卖行"、`FULL_SCAN_NEUTRAL_BUTTON` → "扫描中立拍卖行"（并补 enUS 等主语言；其他语言可留英文）。

**显隐更新点**：



* `Source_LegacyAH\Core\Mixin.lua` 的 `AuctionatorAHFrameMixin:OnShow`（由 `AUCTION_HOUSE_SHOW` 触发）或新增 Forever 事件帧注册 `AUCTION_HOUSE_SHOW` → 调 `Auctionator.Forever:UpdateScanButtons()`：


  * faction → 联盟钮 `Show/Enable`，中立钮 `Hide`（或 `Disable`）

  * neutral → 中立钮可用，联盟钮隐藏 / 禁用

  * nil → 两钮禁用

* 关闭 AH（`AUCTION_HOUSE_CLOSED`）→ 无需处理（按钮随标签页一起隐藏）。

### B. 数据分槽（中立独立存放）



* **中立槽名**：`AUCTIONATOR_PRICE_DATABASE["PvP_N"]`（与导入环境变量配套，见 C）。

* **实现**：

1. `Source_Forever\DatabaseNeutral.lua`：`Auctionator.Forever.DatabaseNeutral = CreateAndInitFromMixin(Auctionator.DatabaseMixin, AUCTIONATOR_PRICE_DATABASE["PvP_N"])`（初始化兜底建空表）。

2. `Source_LegacyAH\FullScan\Mixins\Frame.lua` `EndProcessing`：按 `self.scanMarket` 路由 ——faction 走原 `Auctionator.Database:ProcessScan`；neutral 走 `Auctionator.Forever.DatabaseNeutral:ProcessScan`。事件与提示照旧。

* **说明与坑**：


  * 15 分钟冷却 `TimeOfLastGetAllScan` 两钮共享（同一 FullScanFrame），符合预期。

  * `Variables\Main.lua` 的 "其他槽位 CBOR 序列化" 循环（`C_Timer.After(0,…)`）会把 `PvP_N` 当作 "其他服" 在下次登录后序列化 —— 导入端 `auctionator-sv.ts` 已支持按槽 CBOR 解码，可接受；但**需实施时验证**序列化后导入仍正常（解码路径已存在）。

  * `PLAYER_LOGOUT` 只序列化当前 realm 槽，`PvP_N` 会以原始表落盘（体积大、无碍）；若想体积可控可顺手给 `PvP_N` 也挂序列化（可选优化）。

  * Auctionator 自身 UI（tooltip、购物清单）仍只读联盟 `Auctionator.Database`——**中立市场在游戏内不参与 Auctionator 的买 / 卖辅助**（本次范围外，先记录为已知限制）。

### C. 网页导入（中立数据入库）

`scripts\auctionator-import.ts`：



* 新增 `AQ_AUCTIONATOR_NEUTRAL_SLOT`（默认 `"PvP_N"`）。

* 第二遍 `readAuctionatorSavedVars(SV_PATH, NEUTRAL_SLOT)` → 快照 / 每日行 `market="neutral"`、`faction="Neutral"`（或沿用 `AQ_FACTION`，实施时定）。

* `deleteMany` 也按 `market` 隔离（`market='neutral'` 先删后插，幂等不变）。

* 日志区分两个槽的行数。

**中立展示（已拍板：同页切换）**：



* 查询层 `repositories.ts` 的市场过滤参数化（`market` 入参，默认 `faction`），`getLatestSnapshotTime`/med7 / 信号构建同步支持中立市场（口径与联盟一致：当前价 = 有效最低价）。

* 页面：首页 `/` 与单品页 `items/[itemId]` 加**联盟 / 中立切换**（与现有 `?history=1` 并列，建议 `?market=neutral` URL 参数 + 页头切换按钮，前端 `usePersistedState` 或 URL 参数均可，实施时定）；雷达 / 必赚默认仍只看联盟（混源风险由切换隔离）。

* 缓存键 `market-signals.ts` 已含 mode:latestSnapshotAt:metaVersion—— 需并入 market 维度，避免联盟 / 中立信号互串。

### D. 转录插件并入 Auctionator（已拍板：并入 + 仓库受控副本）

**做法**：

0\. **受控副本（先做）**：把游戏目录整个 `Auctionator\` 复制进仓库 `addon-auctionator\`（含全部 Source/Libs/Locales 等），git 管理；游戏内目录保持同步，升级时对受控副本 diff 重打补丁。



1. 游戏目录 `Interface\AddOns\Auctionator\Source_Forever\` 新增 `Manifest.xml`，引用：

* `Transcript.lua`、`VendorPrice.lua`、`AutoReload.lua`（内容平移，chat 前缀可保留 "WAH 转录 / WAH 重载" 或改统一前缀）

1. `Auctionator.toc`：

* `Source_Forever\Manifest.xml [AllowLoadGameType camelot][ExcludeLoadGameType classic, standard]`（对齐现有 Constants.lua 的写法，仅 Forever 服加载）

* 追加 `## SavedVariables: WAHTranscribeDB / WAHTranscribeState / WAHVendorDB / WAHReloadOpts`

1. 简化 AutoReload：Auctionator 加载完成（`Auctionator.State.Loaded` 或 `Auctionator.EventBus` 就绪）后直接注册，删掉 OnUpdate 轮询；`/wahscan`、`/wahvendor` 斜杠命令保留。

2. 仓库侧：`addon-transcript\` 保留为已并入的存档副本（或删除，用户拍板）。

3. 卸载独立插件：删除 `Interface\AddOns\WoWderhoiAH-Transcript\`（SV 全局变量随插件名变化 —— 注意：**并入后存档全局名不变**，`WAHTranscribeDB` 等仍是全局，网页导入路径零改动）。

**风险（需用户确认接受）**：



* Auctionator 未来升级（覆盖式更新）会把并入代码连同按钮拆分一起冲掉；用户 v3.4 曾因 "插件频繁更新覆盖 / 兼容风险" 放弃过改插件方案 —— 本次按钮拆分本身就是改插件，需确认整体接受 "自改 Auctionator = 升级需重打补丁"。

* 建议：**把游戏内 Auctionator 全目录复制进仓库**（如 `addon-auctionator\`）做受控副本再改，游戏目录同步；升级时 diff 重打。这也解决 "仓库当前没有 Auctionator 副本、改游戏文件无版本管理" 的问题。

## 3. 改动文件清单

游戏内 Auctionator（受控副本 `addon-auctionator\` + 游戏目录同步）：



1. `Auctionator.toc` — Source\_Forever\Manifest.xml 引用 + 4 个 SavedVariables

2. `Source\Tabs\Auctionator\Frames\Main.xml` — 双按钮布局

3. `Source_LegacyAH\Tabs\Auctionator\Mixins\ScanButton.lua` — 市场校验 + scanMarket

4. `Source_LegacyAH\FullScan\Mixins\Frame.lua` — EndProcessing 分槽路由

5. `Source_LegacyAH\Core\Mixin.lua`（或新增 Forever 事件帧）— OnShow 显隐更新

6. `Source_Forever\Market.lua`、`DatabaseNeutral.lua`、`Manifest.xml`、`Transcript.lua`、`VendorPrice.lua`、`AutoReload.lua`（后三个平移）

7. `Locales\zhCN.lua`（+enUS）— 按钮文案

网页仓库：

8\. `scripts\auctionator-import.ts` — 中立槽第二遍导入

9\. `.env.example` / `.env` — `AQ_AUCTIONATOR_NEUTRAL_SLOT`

10\. `src\lib\repositories.ts` / `analytics.ts` / `market-signals.ts` — market 参数化（缓存键加 market 维度）

11\. `src\app\page.tsx`、`src\app\items\[itemId]\page.tsx` — 联盟 / 中立同页切换（`?market=neutral`）+ 测试

12\. `docs\HANDOFF.md` — 更新

## 4. 验证计划



* **游戏内**（用户操作）：联盟 AH 打开 → 仅 "扫描联盟拍卖行" 可点；赤脊山贸易营地中立 AH 打开 → 仅 "扫描中立拍卖行" 可点；未知区域 → 两钮禁用。

* **落盘**：分别扫描后 /reload，`WTF\...\SavedVariables\Auctionator.lua` 出现 `PvP` 与 `PvP_N` 两个槽。

* **导入**：`npm run auctionator:import` → SQLite 按 `market` 分布核对；首页 / 雷达 / 配方不出现中立价（`market='faction'` 过滤回归）。

* **回归**：联盟扫描路径与现在完全一致（同一 `QueryAuctionItems` 查询、同一 `get_all_scan_complete` 事件）→ AutoReload 自动落盘仍触发。

* **并入回归**：`/wahscan start`、商人价记录、自动重载三条链路在新位置正常；网页 vendor 导入、transcript 导入脚本零改动可用。

* 测试：`npx tsc --noEmit && npx vitest run`（导入脚本相关用例）。

## 5. 已拍板决策（2026-10-15）



| # | 决策点      | 用户选择                                              |
| - | -------- | ------------------------------------------------- |
| 1 | 数据分槽范围   | **一步到位**：按钮拆分 + `PvP_N` 分槽 + 网页中立导入               |
| 2 | 中立市场网页展示 | **同页切换**：首页 / 单品页加联盟 / 中立切换（`?market=neutral`）    |
| 3 | 转录并入推进   | **并入 + 仓库受控副本**（`addon-auctionator\`），接受升级覆盖需重打补丁 |
| 4 | 旧转录插件去留  | 并入后删除游戏目录独立插件；`addon-transcript\` 存档保留（默认）        |

## 6. 实施顺序建议



1. 复制游戏内 Auctionator → 仓库 `addon-auctionator\`（受控副本，git 管理）

2. A：Market.lua + 双按钮 + 显隐 → 游戏内验收（联盟 / 中立 / 未知三态）

3. B：`PvP_N` 分槽 + 路由 → 两市场分别扫描落盘验收

4. C：导入脚本中立槽 + 查询层 market 参数化 + 首页 / 单品页同页切换 → SQLite 与页面验收

5. D：转录并入（独立插件目录删除）→ 三条链路回归

6. 更新 HANDOFF，用户验收后按纪律 commit/push