<div align="center">

# WoWderhoi AHelper

[![Release](https://img.shields.io/github/v/release/BrandNewJimZhang/wowderhoi-ah?color=f0479e)](https://github.com/BrandNewJimZhang/wowderhoi-ah/releases)
![Interface](https://img.shields.io/badge/WoW-Forever%201.60.1-ffd94d)
![Stack](https://img.shields.io/badge/Next.js%2016-TypeScript-2ce8a4)
[![License](https://img.shields.io/badge/license-AGPL--3.0--or--later-c493ff)](LICENSE)

**English** | [中文](#中文)

Auction house price intelligence and short-swing trading kit for
World of Warcraft: Forever / Infinite (1.60.1 Beta).

</div>

Two parts, one fully local data loop — no Battle.net API:

- **In-game addon** (`addon/WoWderhoiAH`) — scans the auction house,
  accumulates price history scan-to-scan, and provides tooltip market
  data, dual-window price charts, and a dedicated **WAH trade tab**:
  deal radar, verified one-click buying, undercut sell prefill. The
  addon *is* the data backend.
- **Desktop terminal** (Next.js 16) — a Bloomberg-style dark,
  high-density interface: market monitor table, intraday/daily charts,
  price alerts and watchlists, crafting profit rankings.

New here? Start with [docs/AI.md](docs/AI.md) — the project's single
context document (architecture, data pipeline, conventions, pitfalls).

## Features

### Deal radar (one actionable play per row)

Rows are ranked by **total profit = unit profit × buyable quantity**. When
the top-5 price tiers are known, the radar "sweeps" them (tries buying the
first k tiers and keeps the most profitable plan); otherwise it assumes one
unit and checks only the per-unit gates.

- **Vendor**: buy every listing below the NPC price and sell to the NPC
  (total ≥ 10s, no history needed).
- **Flip**: buy the cheap tiers and relist 1c under the next tier, capped by
  the 7-day reference (unit ≥ max(20s, 15% of buy), total ≥ 1g, ≥ 3 days of
  history).
- **Cross**: buy here, undercut the other market (Alliance ↔ Neutral); both
  sides must be ≤ 48h old.
- **Band**: a volatile, in-demand item that dropped below its 7-day band,
  sold back at the 7-day reference.

All thresholds are editable in the radar settings panel.

### Price statistics

- Every scan produces a **quantity-weighted percentile ladder**
  (min/P5/P10): P10 is the market price; min/P5 mark the very bottom of
  the book. This realm's upper book is thin and stale — nothing trades
  against it — so only the bottom decile reflects real prices.
  Percentiles shrug off bait listings that wreck any mean.
- **Sell front** (depth-aware): the cheapest price with real quantity
  behind it — undercutting *it* matters; undercutting a lone dump
  listing just gives gold away.
- Price history accumulates inside the addon (`WoWderhoiAH_Points`,
  7 days × 192 points); the 7-day P10 median, trend, and range all
  derive from it. No desktop write-back.

### In game

- `/wahscan` full scan: `C_AuctionHouse.ReplicateItems()` whole-AH
  replication with cooldown handling; `/wahauto` auto-rescan (~every 15 min).
- Tooltip market data: sell front leads (orange), then min price,
  P5/P10, supply, 7-day P10 median and trend.
- Price charts beside the auction frame: last 3 hours / last 48 hours,
  plotting the P10 series.
- Sell prefill: buyout auto-filled at an undercut of the sell front.

### Terminal

- Market monitor: search, category filter, sorting, server-side paging —
  handles real 2400+ item scans.
- Item terminal page: intraday (scan-to-scan) chart, daily candles,
  day-of-week seasonality.
- Price alert rules and watchlists.
- Crafting profit ranking (built-in TBC recipe table).
- Self-hosted item icons (`npm run icons:fetch`, one-shot).

## Stack

Next.js 16 + React Server Components + TypeScript · TailwindCSS ·
Prisma + SQLite · Recharts · WoW Lua addon (Interface 16001).

## Development

```powershell
Copy-Item .env.example .env
npm install
npm run db:push
npm run db:seed   # calendar only; market data always comes from real scans
npm run dev
```

Open `http://localhost:3000`. Tests and perf gates:

```powershell
npm run test        # vitest
npm run typecheck
npm run perf:seed   # deterministic synthetic market (leaves dev.db alone)
npm run perf:run    # page/import latency budget gate
```

## Data pipeline (in-game addons)

Two addons, Auctionator stays **stock** (update it from CurseForge/WowUp
freely); all project logic lives in the sidecar addon
`addon-wah/WoWderhoiAH-Transcript` (market detection Alliance/Neutral,
top-5 price tiers, vendor prices).

1. Set `AQ_AUCTIONATOR_SV_PATH` in `.env` (see `.env.example`), then
   `npm run addon:deploy` — copies the sidecar into the game's `AddOns`
   folder (first run also migrates `WAH*` saved data; close the game).
2. In game, open the AH and click **Full Scan**. The market is detected
   automatically (`/wahmarket` shows why; `/wahmarket neutral|faction`
   forces it). Top-5 tiers are fetched right after the scan.
3. `/reload` to flush SavedVariables, with `npm run watch` running — it
   imports `Auctionator.lua` + `WoWderhoiAH-Transcript.lua` automatically.

## Key modules

- `addon/WoWderhoiAH/WoWderhoiAH.lua` — full scanner, quantity-weighted percentiles, scan-to-scan history.
- `addon/WoWderhoiAH/Trade.lua` — WAH trade tab: deal radar, search & buy, sell prefill.
- `addon/WoWderhoiAH/GUI.lua` — tooltip injection and the 3h/48h price charts.
- `scripts/watch-savedvars.ts` — SavedVariables watcher and importer.
- `src/lib/addon-scan.ts` — SavedVariables parsing and scan validation (single entry point).
- `src/lib/analytics.ts` — 7d P10 median signals, deal radar rules, seasonality.
- `src/app/page.tsx` — market overview: deal radar, monitor table, alerts/watchlist/crafting.
- `src/app/items/[itemId]/page.tsx` — item terminal, intraday and daily charts.
- `scripts/perf/` — deterministic perf benchmarks and latency budget gates.

## License & contributing

[AGPL-3.0-or-later](LICENSE). PRs welcome — every PR must be linked to
an issue; see [CONTRIBUTING.md](CONTRIBUTING.md). Security notes in
[SECURITY.md](SECURITY.md).

---

<div align="center">

## 中文

[English](#wowderhoi-ahelper) | **中文**

</div>

《魔兽世界》无限服（WoW: Forever / Infinite 1.60.1 Beta）拍卖行价格情报与短线交易工具。两个部件，一条本地数据闭环，不依赖 Battle.net API：

- **游戏内插件**（`addon/WoWderhoiAH`）——扫描拍卖行、逐次积累价格历史，提供 tooltip 行情、双窗口价格走势图，以及独立的 **WAH 交易页**：捡漏雷达、核验后一键购买、压价卖单预填。插件即数据后端。
- **桌面终端**（Next.js 16）——类 Bloomberg 的深色高密度界面：市场监控表、盘中/日线图表、预警与关注列表、制造利润排行。

新用户从 [docs/AI.md](docs/AI.md) 开始：项目唯一上下文文档（架构、数据链路、口径与坑）。

### 核心功能

**捡漏雷达**（每行一个可执行的赚金动作，按总利润 = 单件利润 × 可买量排序）

- **必赚**：买下所有低于 NPC 收购价的挂单卖给 NPC（总利润 ≥ 10 银，无需历史）。
- **扫货**：买下便宜档位，在下一档下方 1 铜回挂（不超过 7 日参考；单件 ≥ max(20 银, 买价 15%)，总利润 ≥ 1 金，历史 ≥ 3 天）。
- **跨市场**：这里买，在另一市场（联盟 ↔ 中立）压价 1 铜卖出；两边数据都需 ≤ 48 小时。
- **波段**：高波动、需求广的物品跌破 7 日带下沿，回到 7 日参考价卖出。
- 有前五档时按真实档位计算可买量；门槛都可在雷达设置里调整。

**价格统计**

- 每次扫描产出**量加权百分位阶梯**（最低/P5/P10）：P10 是市价，最低/P5 标出订单簿最底部。本服上层挂单又薄又陈、根本没有成交，只有底部十分位才反映真实价格；百分位天然抗钓鱼挂单。
- **建议卖价**（深度感知卖价前沿）：有真实量支撑的最低价，而非孤立甩卖单——压过它才有意义，压过甩卖单只是白送钱。
- 价格历史由插件逐次扫描自行积累（`WoWderhoiAH_Points`，7 天 × 192 点），7 日P10中位、趋势、区间全部由它派生，无需桌面端回写。

**游戏内**

- `/wahscan` 全量扫描：`C_AuctionHouse.ReplicateItems()` 全拍卖行复制 + 冷却处理；`/wahauto` 挂机自动扫描（约 15 分钟一次）。
- tooltip 行情：建议卖价领衔（橙色标注），随后最低价、P5/P10、供给、7 日P10中位与趋势。
- 拍卖行旁价格走势图：最近 3 小时 / 最近 48 小时双窗口，绘制 P10 低位价序列。
- 卖货预填：自动以建议卖价压价填入买断价，确认后发布。

**终端**

- 市场监控表：搜索、分类过滤、排序、服务端分页，扛得住 2400+ 商品的真实扫描。
- 商品终端页：盘中走势、日线 K 线、星期几季节性。
- 价格预警规则与关注列表。
- 制造利润排行（内置 TBC 配方表）。
- 自托管商品图标（`npm run icons:fetch` 一次性抓取）。

### 本地开发与数据采集

开发命令与数据管道步骤见上方英文版（命令相同）：`npm run dev` 起终端；`npm run addon:deploy` 把旁挂插件 WoWderhoiAH-Transcript 装进游戏（Auctionator 保持原版、可随意更新）；游戏内点「完整扫描」（市场自动识别，`/wahmarket` 查看/手动指定）后 `/reload` 落盘，`npm run watch` 自动入库。
