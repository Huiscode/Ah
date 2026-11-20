# 公测清场 + 国服(联盟)接入：首扫就绪

## Context

公测已于 2026-11-07 开服，用户尚未做过任何正式扫描。**清空现状已核实**：Ah 数据库（beta 欧服联盟槽 3880 物品/16726 日线 + 中立槽 647 物品等）随 `prisma\dev.db` 于 11/1 删除；欧服游戏存档为开服后新文件（价格库仅空 `["PvP"]` 槽、零条目、无扫描时间戳）；国服零数据。按 HANDOFF §5/§7"公测清空"纪律（SQLite + SavedVariables + 导入进度，代码/git 保留），**剩余要清的只有仓库侧导入状态/进度文件**。本任务：清残留 → 重建参照数据 → 国服接入（第二路 watch + 国服客户端装插件）→ 重启服务，使用户在国服联盟主城首扫 + `/reload` 后数据自动以 `server='cn'` 进入网页。

**边界（用户明示）**：FalconAH 是用户另一个独立项目，已部署在欧服游戏目录 `WoW_eu\_forever_\Interface\AddOns\Auctionator`（toc 已改 `FAL*` 全局 + 新增 Plan.lua，存档中亦为 `FAL*` 空表）——**绝不同步/覆盖/适配它**；Ah 对欧服只读 `Auctionator.lua`（价格库 `AUCTIONATOR_PRICE_DATABASE` 名称未变，仍可导入；欧服侧 WAH*/档位/商人价缺失属预期）。

**自动识别口径（答复用户）**：server 标识=按存档路径自动打标（欧服/国服两个安装、两个账号目录天然隔离，配好 `.env` 第二路 + 重启 watch 后国服数据全自动打 `cn`，无需手动切换——现状旧路径全部失效所以还识别不了，本次配好）；联盟/中立=插件按地点白名单自动分槽（暴风城/铁炉堡/达纳苏斯→`PvP` 槽，白名单本就是中文地名，国服客户端开箱即用）；faction 恒为 Alliance。欧服新存档已确认槽位键为 `"PvP"`。用户拍板：**双服都盯、网页默认保持欧服**（`DEFAULT_SERVER` 不改）。

## 必要代码修复（beta 遗留死路径 + watch 死循环，小改动）

1. **转录/商人价死路径**：自 10/15 转录并入 Auctionator 起，`WAHTranscribeDB/WAHVendorDB/WAHScanTimes` 写入 `Auctionator.lua`，而 `.env`/watch 默认的 `WoWderhoiAH-Transcript.lua` 已死（`.sync-last.json` 佐证：该文件 mtime 停在 10/15）。修复=`.env` 把 `AQ_TRANSCRIPT_SV_PATH(_2)` 指向各服 `Auctionator.lua`；`transcript-import`（fengari 整文件执行取 `WAHTranscribeDB`）与 `vendor-sv.loadVendorGamePrices`（取 `WAHVendorDB`）即可工作（utf8 读取不破坏 Lua 语法，CBOR 二进制串不影响这两个明文表；`watch` 的 `loadVendorGamePrices(sw.transcriptSv)` 无需改）。
2. **watch 死循环防护**：`scripts/transcript-import.ts:92-120`（存档缺失/无 WAHTranscribeDB/scans 为空）与 `scripts/auctionator-import.ts:164-168`（价格库为空）目前 `process.exit(1)`——在 watch 中 execSync 抛错 → `saveState()` 不执行 → **每 2 秒无限重试**。这些在双服场景是正常态（欧服 FAL 文件无 WAH*；国服首扫后可能无补档候选；未扫描的新存档价格库为空）。改为优雅退出（exit 0 + 提示日志）；真正的 Lua 解析/执行错误保留 exit(1)。
3. **后备（仅当首扫验证失败才做）**：若 fengari 执行真实大存档（数百 KB 含 CBOR）出错，改走 `src/lib/auctionator-sv.ts` 的 `extractTopLevelVariable` 提取路线（该文件 265-275 行已有 `WAHScanTimes` 先例），扩展其同时提取 `WAHTranscribeDB/WAHVendorDB`，`transcript-import`/`vendor-sv` 改用解析器结果。

## 实施步骤

**A. 清残留**（删除）：`scripts\.sync-last.json`、`scripts\.watch-state.json`、`scripts\.ilvl-progress.json`、`scripts\.m1b-progress.json`、`scripts\.vendor-audit-progress.json`、`scripts\.vendor-forever-fix-progress.json`；（可选）根目录 `.dev-restart.log`。欧服存档**不动**（已是开服新文件，且属 FalconAH 域）。确认仓库内确无 `dev.db*` 残留。

**B. `.env` 重写**：
- 服务器1（eu）：`AQ_AUCTIONATOR_SV_PATH` 与 `AQ_TRANSCRIPT_SV_PATH` → `C:\Program Files (x86)\WoW_eu\_forever_\WTF\Account\1120133458#1\SavedVariables\Auctionator.lua`（两键同文件）
- 服务器2（cn）启用：`AQ_SERVER_KEY_2="cn"`、`AQ_AUCTIONATOR_SV_PATH_2` 与 `AQ_TRANSCRIPT_SV_PATH_2` → `C:\Program Files (x86)\WoW_cn\_forever_\WTF\Account\168873568#1\SavedVariables\Auctionator.lua`（显式指定，避免 watch 同目录推导出死文件名）
- 注释掉失效遗留键：`AQT_*`（指向已删的 WoWderhoiAH.lua 与已删的 /api/import/addon-scan 端点）、`AHL_*`（无活跃消费方）；`DATABASE_URL` 保留。

**C. 重建 DB 与参照数据**（全部幂等/断点续跑，foreverchanges.pro 403 自动退避）：
1. `npm run db:push`（新建 `prisma\dev.db`）
2. `npx tsx scripts/scrape-forever-recipes.ts`（Recipe 全量入库）
3. `npx tsx scripts/m1b-forever-library.ts`（物品名/品质/分类 + vendor 价；`M1B_INTERVAL_MS=0` 快速跑，用户既有偏好）
4. `npx tsx scripts/compute-turnover.ts`（流通分/商人货标记重算）
5. `npx tsx scripts/backfill-item-level.ts`（分解榜 ilvl，21 页）
6. `npm run icons:fetch`（重建 Item.icon，public\icons 本地已有）
- 验收：Recipe ≈2.5k 行、配方相关 Item 无 "Item N" 占位、`item_level` 有值。

**D. 国服客户端装插件**：`robocopy "C:\Users\Hz\Documents\Workspace\Ah\addon-auctionator" "C:\Program Files (x86)\WoW_cn\_forever_\Interface\AddOns\Auctionator" /E`（写入 Program Files 若被拒/需管理员，把命令交给用户执行）。**绝不触碰 WoW_eu 的 Auctionator 目录。**

**E. 重启服务**：`Ah_Stop.bat` → `Ah_Start.bat`；验收 `logs\auto-import.out.log` 出现"监视服务器：eu、cn"。

**F. 首扫（用户游戏内操作）**：国服联盟角色在暴风城/铁炉堡/达纳苏斯打开 AH → 点联盟扫描 → 完成后**手动 `/reload`**（无限版禁插件 ReloadUI，落盘靠手动）→ watch 自动导入。

**G. 首扫验证**：
- watch 日志：cn 导入成功、无报错循环
- `npx tsx scripts/verify-server-split.ts`（cn 有数据）
- `http://localhost:3000/?server=cn` 行情表正常
- 核对国服存档 `AUCTIONATOR_PRICE_DATABASE` 槽位键 == `"PvP"`（欧服已确认；zhCN 客户端待核）；**若不是**（如 PvE/中文名）→ 导入会静默为空，需给 watch+import 加 per-server 槽位 env（`AQ_AUCTIONATOR_REALM_SLOT_2`）小改动
- 确认插件在国服客户端正常加载（toc Interface 含 16001；若未加载则补国服 build 号）

**H. 回归**：`npx tsc --noEmit && npx vitest run`（187 测试）通过。

**I. 记忆落盘**（`C:\Users\Hz\.zcode\cli\memories\projects\ah-b8d151c04ada6f97\memory\`）：①FalconAH 独立项目、部署在欧服插件目录（FAL*+Plan.lua）、永不覆盖/干涉；②双安装路径（WoW_eu / WoW_cn、国服账号 168873568#1）；③WAH* 全局写入 Auctionator.lua、WoWderhoiAH-Transcript.lua 已死、转录路径须指向 Auctionator.lua；④公测 2026-11-07 开服及本次清场时间线。

## 不做

不动 FalconAH（欧服插件目录/存档只读）；不改 `DEFAULT_SERVER`（保持 eu）；不 commit/push（用户未点名）；不动 `docs/plans/guguah-replication-plan.md`（独立待决）。

## 关键文件

- 修改：`.env`、`scripts/transcript-import.ts`、`scripts/auctionator-import.ts`；（后备）`src/lib/auctionator-sv.ts`、`src/lib/vendor-sv.ts`、`scripts/watch-auto-import.ts`
- 删除：`scripts\.sync-last.json`、`scripts\.watch-state.json`、`scripts\.ilvl-progress.json`、`scripts\.m1b-progress.json`、`scripts\.vendor-audit-progress.json`、`scripts\.vendor-forever-fix-progress.json`
- 新建：`prisma\dev.db`（db:push）、`C:\Program Files (x86)\WoW_cn\_forever_\Interface\AddOns\Auctionator\`（robocopy）