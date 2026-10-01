# docs/archive — 一次性分析产物归档

> 本目录存放历次审计/探查产生的一次性源数据、解码结果与临时脚本。全部以 `.tmp-` 开头，被 `.gitignore` 忽略（`scratch files and local artifacts — never tracked`），**不要提交到 git**。可随时清理；需要重跑核验时按各组说明操作。

## 内容分组

| 组 | 文件 | 来源 / 用途 |
|---|---|---|
| 源页面抓取 | `.tmp-page-<专业>.html`、`.tmp-items-list-1..20.html`、`.tmp-recipes7.html`、`.tmp-wx-db.html`、`.tmp-probe-<专业>.html` | foreverchanges.pro 各专业页 / 物品列表 20 页 / 旧配方源的原始 HTML |
| 解码数据 | `.tmp-probe-<专业>-decoded.txt` | 由 `scripts/decode-pages.mjs` 从上述 HTML 解码出的 Next.js RSC payload |
| 审计结果 | `.tmp-audit-<专业>.json`、`.tmp-verify-favor-report.json`、`.tmp-turnover-before/after1/after2.json`、`.tmp-parse.out` | 流通分/青睐配方覆盖审计的结构化结果与快照 |
| 一次性脚本 | `.tmp-*.cjs / .mjs / .py / .js / .lua`（含 `.tmp-luacheck/` 依赖目录） | 各次核验用临时脚本与数据转储（如 `.tmp-wx-item.js`） |
| 临时可视 | `.tmp-percentile-vis.html` | 分位数可视化样例 |

## 对应报告

- `docs/reports/favor-turnover-audit.md` — 商人青睐配方·流通分覆盖核验（§5 脚本清单）
- `docs/reports/consumables-turnover-audit.md` — 消耗品配方·流通分核验（§7 快照与重算命令）

## 重跑入口

- 流通分全量重算：`npx tsx scripts/compute-turnover.ts`（幂等）
- 页面解码：`npx tsx scripts/decode-pages.mjs`
