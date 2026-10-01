# 商人青睐配方·流通分覆盖核验报告

> 日期：2026-10-01。范围：foreverchanges.pro 全部专业页面的"商人青睐配方"（favor 数组）涉及材料的流通分（`Item.turnoverScore`）来源核验。
> 结论先行：**10 个专业页面全部核验完毕，317 条 favor 配方涉及的材料 100% 已有计数来源（本地 Recipe 或 scripts/data/forever-enchants.json），缺失 0 条，无需任何新录入。** 重算幂等（前后 sha256 完全一致），`tsc --noEmit` 0 错误，vitest 28 文件 189 测试全通过。

## 1. 核验方法

- 数据源：每个专业页面的 Next.js RSC payload（已下载并解码保存为项目根的 `.tmp-probe-<slug>-decoded.txt`，原始 HTML 为 `.tmp-page-<slug>.html`）。用 `"key":` 定位 + 括号配对 + `JSON.parse` 提取 `favor`（商人青睐数组）、`rows`/`crafted`（全量配方，含 reagents）、`enchants`（装备附魔）、`items`（物品中文名）。
- 流通分口径（与 `scripts/compute-turnover.ts` 一致）：本地 Recipe 表**全部行** reagents 中出现的每个 itemId + `forever-enchants.json` 的 `enchants`/`craftedMissing` reagents 中的每个 id，每配方每材料计一次。
- favor 条目三类：
  - `recipe.makes` 非空：制造配方 → 材料取自页面 rows/crafted 中 `id==makes` 的元素；
  - `recipe.makes == null`：装备附魔（仅附魔页 21 条）→ 材料取自 `enchants` 数组按 `recipe.name` 匹配；
  - `recipe == null`：无材料。其中物品名以"认证"结尾的（favor=1000）是无材料专业认证；其余是"公式/设计图"物品直购（材料在本地 merchant 配方，不在页面侧）。

## 2. 逐专业覆盖结论（favor 条目 → 材料引用 → 计数来源）

| 专业 | favor 条数 | 有材料配方 | 材料引用次数 | 缺失材料 |
|---|---:|---:|---:|---:|
| 炼金 Alchemy | 30 | 29 | 83 | 0 |
| 锻造 Blacksmithing | 62 | 60 | 298 | 0 |
| 附魔 Enchanting | 40 | 36 | 163 | 0 |
| 工程 Engineering | 29 | 28 | 86 | 0 |
| 制皮 Leatherworking | 82 | 81 | 446 | 0 |
| 裁缝 Tailoring | 68 | 67 | 351 | 0 |
| 烹饪 Cooking | 6 | 6 | 18 | 0 |
| 急救 First Aid | 0 | — | — | — |
| 钓鱼 Fishing | 0（页面无 favor 键） | — | — | — |
| 露营 Camping | 0（页面无 favor 键，纯说明页） | — | — | — |
| **合计** | **317** | **307** | **1445** | **0** |

- 无材料条目共 10 条：6 条专业认证（炼金/锻造/附魔/工程/制皮/裁缝学认证，id 271621–271627，favor=1000，无材料）+ 4 条公式/设计图直购（锻造「设计图：督军护腰」251426；附魔「公式：梦境神像」249529、「公式：神圣灵动圣契」249530、「公式：雷霆图腾」249532——其材料在本地 merchant 同名配方且非空）。
- 本结论经**两套独立实现**交叉验证（见 §5），数字一致。

## 3. 关键发现

1. **附魔页既有成果复核通过**：21 条装备附魔公式材料按"材料 id 集合"逐一命中 `forever-enchants.json`（21/21）；15 条圣物/法杖/魔杖制造配方 + 3 条公式直购全部由本地 merchant「公式：XX」覆盖，其中 2 条名称有出入（「《白银之手的信条》」→「公式：白银之手的信条」、「先祖防护图腾」→「公式：先祖护佑图腾」），本地材料与页面完全一致。既有证据已在库生效：小块闪光碎片(11138)=3、次级星界精华(10998)=11。
2. **工程 5 条配方以英文名收录于本地**：「一袋铜壳炸弹」等 5 条 favor 配方在本地 Recipe 中以英文名存在——craft「Satchel of Copper Bombs」「Satchel of Bronze Bombs」「Compact Critter Carrier」「Satchel of Iron Bombs」「Satchel of Dark Iron Bombs」与 merchant「Schematic: …」，材料与页面 rows **完全一致**（wx-wow 种子对这 5 条未本地化，仅名称问题，不影响计数）。
3. **炼金「先知药剂」唯一材料差异（非缺口）**：本地 craft「先知药剂」材料（梦叶草×1、瘟疫花×2、水晶瓶×1）与页面（梦叶草×4、黄金参×2、灌魔之瓶×1）不一致；但本地 merchant「配方：先知药剂」材料与页面**完全一致**（黄金参 13464、灌魔之瓶 18256 均已计入：turnover=11、18）。craft 行为 wx-wow 旧数据差异，不影响 favor 材料覆盖；未修改（用户未要求改数据口径）。

## 4. 重算与回归验证

- `npx tsx scripts/compute-turnover.ts` 重算：2265 条 Recipe + 166 条附魔配方（forever-enchants.json），共 525 种材料。
- 重算前后全量快照（`Item.turnoverScore`/`isVendorItem` 逐条 + sha256）：`4fb5922f2c771f2665bfdd17ef6840877138badd24ff47c7c71a6ec3d71dab05`，**字节级一致**（幂等）——当前库已完整反映所有计数来源，无任何 favor 材料缺失。
- `npx tsc --noEmit`：exit 0。`npx vitest run`：28 文件 / 189 测试全部通过。
- **未做变更**：未新增/修改 scripts/data/ 下数据文件（无缺失需录入）；`compute-turnover.ts` 无需调整；未 git 提交未 push。

## 5. 核验脚本清单（可复现）

| 脚本 | 作用 |
|---|---|
| `scripts/decode-pages.mjs` | 从已下载页面 HTML 解码 RSC payload 到 `.tmp-probe-<slug>-decoded.txt` |
| `scripts/audit-favor.mjs` | 单专业 favor 覆盖审计（按名称 + 产出物品 ID 匹配本地，材料一致性交叉验证） |
| `scripts/audit-all.mjs` | 批量运行全部专业审计 |
| `scripts/union-check.mjs` | 并集检查：favor 材料 ⊆ 本地 Recipe reagents ∪ forever-enchants.json reagents |
| `scripts/.tmp-verify-union-self.mjs` | 独立核验（Subagent A 自写实现）：并集检查，0 缺失 |
| `.tmp-verify-favor-consistency.cjs` | 独立核验（Subagent B 自写实现）：本地↔页面材料一致性，286 条仅 1 条已知差异 |
| `.tmp-verify-favor-report.json` | Subagent B 的结构化报告 |

两套独立实现（Subagent A/B，均禁止查看对方/既有脚本实现）与本文 §2 结论完全一致。核验全程只读：未写 prisma/dev.db、未改 scripts/data/ 与任何源文件。
