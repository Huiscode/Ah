# AH 项目交接文件（HANDOFF・v3.8 精简版）

> **新 AI 接手流程**：先读 `docs/PRODUCT.md`（产品全貌/架构/口径/血泪结论）→ 再读本文件（当前状态/待办/坑/纪律）。
> 最后更新：2026-10-16 晚（双市场 + 转录并入 + 扫描引擎切换全链路落地，全部功能修复已同步游戏目录）。

## 1. 一句话现状

**全链路已闭环**：联盟/中立双市场（分槽 PvP/PvP_N）扫描与导入正常、增量扫描引擎平滑无冷却、转录已并入、网页双市场同页切换。剩余事项：git 未 commit（等用户指示）；无已知功能性问题。

## 2. 环境与关键路径

| 项 | 路径 |
|---|---|
| 项目根 / 真实 DB | `C:\Users\Hz\Documents\Workspace\Ah` / `prisma\dev.db`（**根目录 `dev.db` 是 0 字节陷阱**） |
| 游戏客户端 | `C:\Program Files (x86)\World of Warcraft\_classic_beta_\`（**官方无限版** camelot 1.60.1 / build 16001，**非私服**） |
| 插件（游戏内） | `...\_classic_beta_\Interface\AddOns\Auctionator\`；**仓库受控副本 `addon-auctionator\`**（改插件先改副本再 robocopy 同步，升级官方版会被覆盖需 diff 重打） |
| 插件 SV 存档 | `...\WTF\Account\1120133458#1\SavedVariables\Auctionator.lua`（槽 `PvP`=联盟、`PvP_N`=中立，含 WAH* 转录存档；`.manual-merge.bak` 备份） |
| 双市场代码 | `Source_Forever\Market.lua`（地点白名单判定+按钮路由）、`DatabaseNeutral.lua`（PvP_N 懒建+CBOR 解码）、扫描 `EndProcessing`/`NextStep` 按 `CurrentScanMarket` 分槽 |
| 转录并入 | `Source_Forever\Transcript.lua` / `VendorPrice.lua` / `AutoReload.lua`（独立插件目录已删，存档全局名不变） |
| 网页 market 参数化 | `src\lib\repositories.ts`（**函数签名顺序易踩坑，见 §6**）、`market-signals.ts`（缓存 key 加 market）、`src\app\page.tsx` / `items\[itemId]\page.tsx`（`?market=neutral`） |
| 导入脚本 | `scripts\auctionator-import.ts`（双槽）、`transcript-import.ts`、`vendor-game-import.ts`、`watch-auto-import.ts`（常驻自动导入，`npm run watch`） |
| 一键启停 | `WAH一键启动.bat` / `WAH一键停止.bat` → `scripts\launch-services.ps1` |

## 3. 当前数据现状（已导入网页库）

- **联盟槽 PvP**：3880 物品 / 3879 快照 + 16726 每日
- **中立槽 PvP_N**：647 物品 / 646 快照 + 844 每日
- 存档文件：`Auctionator.lua`（464 KB 级）；旧转录存档已合并

## 4. 已完成并验证（勿重蹈）

1. **双市场按钮 + 地点判定 + 分槽**：联盟/中立按钮按 `GetRealZoneText()` 白名单（联盟=暴风城/铁炉堡/达纳苏斯，中立=艾尔文森林/赤脊山）自动显隐，未知区域两钮禁用；数据分槽 PvP/PvP_N **严禁混槽**
2. **扫描引擎切换**：按钮优先走 **IncrementalScan（`SendBrowseQuery` 逐页）**——平滑 0-100%、无 15 分钟冷却、可无限重扫、中立可用（用户核心诉求，对标 AUC）。replicate 全量已降级为回退（有硬冷却+10% 停顿）
3. **转录并入**：三文件平移 + toc 6 行 camelot + 4 个 SavedVariables；旧存档合并进 Auctionator.lua
4. **中立 CBOR 错误风暴修复**：`Source\Variables\Main.lua` 串行化循环排除 `PvP_N`（不再编码成 CBOR 字符串）；`DatabaseNeutral` 懒建时先 `DeserializeCBOR` 解码
5. **网页解析器三层修复**（`src\lib\auctionator-sv.ts`）：大括号配对提取顶层块 / `lua_tojsstring` 解码字符串 / 明文 Lua 表槽解析（`extractTableField` + fengari 求值）——中立 646 快照已导入验证
6. **AutoReload 最终形态（v0.3.0）**：无限版**禁止插件调用 ReloadUI**（拍卖行开/关都禁，taint.log 空、存档时间戳实证）→ **自动重载废弃，改为扫描完成提示用户手动 /reload**；提示**默认静默**（`/wahvendor reload on` 可开）；EventBus listener 内严禁 chat（污染 SecureTypes），chat 全在独立 OnUpdate 帧
7. **GameTooltip nil 弹窗**：无限版原生 bug（`GameTooltip_SetDefaultAnchor`，错误栈无插件代码），非插件问题；`/console scriptErrors 0` 关闭（**会话级，游戏内显式执行，reload 不重置**；Config.wtf 写入会被游戏写回覆盖，不可靠）
8. 网页端 repositories 修复：`pickLatestDate`（过滤 undefined）+ 3 项回归测试
9. **每市场扫描时间（WAHScanTimes，2026-10-16）**：存档 `TimeOfLastBrowseScan` 是全局字段，扫任一市场都刷新它 → 导入时联盟/中立快照共用 → "扫中立后联盟也显示刚刚"误报。插件 AutoReload 扫描完成事件把 `CurrentScanMarket` 对应时间写入 `WAHScanTimes`（新 SavedVariables，toc 已加）；解析端 `scanTimes` 字段、导入端 `scannedAt` 优先 `scanTimes[market]`（**必须 `time()` Unix 秒，勿用 `GetTime()` 相对秒——曾导致"20741 天前"**；无本市场扫描时间时按该市场数据最后一天近似，空市场回退全局）。顺带修复 `luaValueToJS(L: number)` 类型声明（应为 `LuaState`）+ `luaL_loadbuffer` name 参数 `to_luastring`。新增 2 项单测；tsc 干净、169 测试通过。**注意**：两市场各自扫过一次后 WAHScanTimes 才完整，之前联盟/中立时间戳互有近似

## 5. 待办 / 未完成

- **git**：✅ v3.7-v3.8 批次已 commit + push（双市场+转录并入+引擎切换+时间戳修复+文档）；后续改动未提交（等用户指示"推/推一版"）
- **转录全量重扫**（可选）：用户现已走 Auctionator 扫描 + watch 导入，转录（/wahscan）为可选补充
- **锻造 5 条高级护腕设计图**缺同名 craft 成品配方（军官/哨兵/守望者/督军/裁决者护腕，可后续补抓）
- **POSTING_HISTORY**：当前为空，`PostingRecord` 表已建、解析口子就绪
- **公测清空运行时数据**：由用户通知触发（SQLite + SavedVariables + 导入进度；代码/git 保留）

## 6. 已知坑 / 机制限制（重点）

- **SV 落盘**：登出/`/reload` 才写盘；游戏内扫完必须手动 `/reload`（无限版禁插件 ReloadUI）→ 网页才更新
- **repositories 函数签名顺序**：`getMarketSignals(market, mode)`、`getMarketUniverse(market, mode)`、`getItemDetail(itemId, mode, market)`、`getLatestRoundItemIds(mode, market)`、`getLatestPricesByItemIds(itemIds, mode, market)`、`getMed7Aggregates(itemIds?, mode, market)`、`getLatestSnapshotTime(market, mode)`；`pickLatestDate(...)` 过滤 `instanceof Date`
- **Auctionator.lua 解码三坑**：ASCII 转义+原始二进制混合（latin1 字节保真读）；Lua `\DDD` 转义；CBOR byte-string 键
- **taint 纪律**：EventBus 回调链内严禁 AddMessage/ReloadUI；只做纯赋值；操作全在独立 OnUpdate 帧
- **slash 命令黄字**（/auc、/wahvendor）：无限版对插件 slash 命令的通用警告，不影响功能（`ReloadUI` 移除后自动重载不再产生新黄字）
- **scriptErrors**：`/console scriptErrors 0` 会话级；游戏内显式执行；Config.wtf 会被游戏覆盖
- **Prisma DLL 锁**：后台 audit 占用时 build 的 prisma generate EPERM → 先停 audit 再 build
- **Next 旧 chunk 残留**（单页 500）：删 `.next` 全量重建
- **foreverchanges.pro 限流**：批量抓 403 → 限速 2.5s+ 退避
- **fengari 解析**：需 `to_luastring`；`lua_tostring` 返回 Uint8Array（用 `lua_tojsstring`）；字符串 "2589" 与数字 2589 是不同键
- **Prisma `$queryRaw` Json 列**已反序列化，勿再 JSON.parse

## 7. 用户偏好 / 协作纪律

- **回复用中文**；称呼语气自然
- **git**：不主动提交/推送；"推/推一版"才 push，"提交 git"才 commit；只提交点名范围
- **公测清空**：由用户通知触发；开服清空全部运行时数据（SQLite + SavedVariables + 导入进度），代码/git 保留
- **双市场判定只用地点**（无挂单量回退，宁可不扫不误判）；**数据严禁混槽**
- **扫描体验对标 AUC**：平滑逐页、可无限重扫（反复强调的核心诉求，勿改回 replicate）
- **vendor 权威顺序**：游戏内实时商人价 > foreverchanges 无限服版（it-add）卖价；不接受 Auctionator 缓存价
- **网页等长期服务在本机跑着**：改动后别重启/杀错进程；`npm run watch` 是唯一同步入口
- **服务启动**：用 `C:\Program Files\nodejs\node.exe`（勿用沙箱版 node）

## 8. 常用命令 / 故障速查

```
cd C:\Users\Hz\Documents\Workspace\Ah
npx tsc --noEmit && npx vitest run   # 类型+测试
npm run watch                        # 常驻自动导入（唯一同步入口）
npm run auctionator:import           # 双槽导入（联盟+中立）
npm run transcript:import / vendor:import
# 改插件：改 addon-auctionator\ → lua-syntax-check → robocopy /E 同步 → 用户 /reload
```

- **"网页没更新"** → 查存档 `Auctionator.lua` 的 LastWriteTime + DB `MAX(timestamp) GROUP BY source`——几乎总是"游戏没落盘"→ 让用户手动 `/reload` 再等 watch 自动导入
- **"某物品没价格"** → 未被扫描到（reload 后跑 auctionator:import 核对双槽）
- **"NPC 价格不对"** → vendor 权威：游戏内实时 > 网站无限服版；`vendor-price-audit.ts` 全量核对（断点续跑）
