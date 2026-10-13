# archive/ — 下线功能归档（代码保留，git 历史可恢复）

2026-10-13 用户拍板：废除自研插件（WoWderhoiAH addon）与旧网页功能，改用
Auctionator 插件（Forever 客户端适配版）为网页提供数据。以下模块从运行时代码
下线，移入本目录**仅作归档**，不再编译/运行。恢复方法：git 历史里这些文件
仍存在（`git log --all -- <path>`），或直接从本目录拷回原路径。

## 页面（原 src/app）
- `pages/neutral/` — 中立市场页（/neutral），随中立市场整体下线
- `pages/arbitrage/` — 跨市场倒卖页（/arbitrage），随中立市场整体下线
- `pages/ledger/` — 成交账本页（/ledger），待 Auctionator POStING_HISTORY
  结构明确后由 PostingRecord 表重建（表已建，解析器已留口子）

## 插件本体（原 addon/）
- `addon/WoWderhoiAH/` — 自研插件全部源码（Lua + GeneratedRules.lua）
- `addon/test/` — 插件/网页雷达一致性对比测试（口径已变，不再适用）

## API（原 src/app/api）
- `api/ledger/` — 清空账本（POST /api/ledger/clear）
- `api/import-ledger/` — 账本导入（POST /api/import/ledger）
- `api/item-ladder/` — 价格档位接口（GET /api/items/:id/ladder）
- `api/import-rules/` — 插件雷达规则同步（POST /api/import/rules）
- `api/import-addon-scan/` — 旧插件扫描导入（POST /api/import/addon-scan）

## 库（原 src/lib、src/data）
- `lib/cross-market.ts` + test — 跨市场配对引擎（依赖中立市场）
- `lib/ladders.ts` — 价格档位查询（Auctionator 无 ladder 概念，删除）
- `data/market-fees.ts` — 中立/联盟费率表（跨市场专用）

## 组件（原 src/components）
- `components/price-ladder-panel.tsx` — 价位阶梯面板（ladder 下线）
- `components/clear-ledger-button.tsx` — 清空账本按钮（ledger 下线）

## 脚本（原 scripts）
- `scripts/gen-lua-rules.ts` + test — 雷达规则编译进插件 Lua（插件下线）
- `scripts/compare-radar-plugin-web.ts` — 插件/网页雷达一致性对比
- `scripts/watch-savedvars.ts` — 旧插件 SavedVariables 常驻监听（被
  auctionator-import.ts 一次性导入替代）

## 保留但不再喂新数据的旧链路
- `src/lib/addon-scan.ts`（+ test）— 旧插件扫描解析（历史 47 万行 P10 数据
  在库中，供"历史模式"参考曲线展示）
- `src/lib/import-common.ts` / `src/lib/scan-import.ts` — 旧导入管道
- `scripts/purge-ahledger-history.ts`、`scripts/reconcile-addon-points.ts` —
  历史数据维护工具
