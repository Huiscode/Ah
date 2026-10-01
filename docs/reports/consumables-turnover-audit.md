# 消耗品覆盖·流通分修复与审计报告

> 日期：2026-10-01。范围：站方可制造消耗品（含爆炸物）制造配方材料的流通分（`Item.turnoverScore` / `Item.isVendorItem`）覆盖缺口修复，以及 `scripts/compute-turnover.ts` 中商人货误标归零的修正。
> 结论先行：**是，所有炸弹与可制造消耗品的材料现已全部计入流通分。** 站方可制造 1985 个产出（含 432 件消耗品实例）中，本地在库原覆盖 430 件、缺口 2 件（均工程），本次已新建 `scripts/data/forever-consumables.json` 补齐这 2 条配方；同时修正了 6 项被误标为商人货而强制归零的材料（外加 2 条 id 错位顺手清理）。修复后重算幂等（After1==After2 sha256 逐字节一致），`tsc --noEmit` 0 错误，vitest 28 文件 / 189 用例全部通过。

## 1. 核验方法

- 组织方已完成两份独立缺口分析（`scripts/data/gap-consumables.json` 与 `gap-consumables-verify.json`）并交叉核验一致，本报告直接采用其结论，不再重复分析。
- 站方配方全集 1988 条（foreverchanges.pro 各专业页面），其中可制造产出 1985 个、消耗品 1539 件；本地 Recipe 表对消耗品实例覆盖 430/432，缺口 2。
- 流通分口径与 `scripts/compute-turnover.ts` 一致：本地 Recipe 表 reagents（含图纸/成品去重合并）+ `forever-enchants.json` + 本次新增 `forever-consumables.json` 的 reagents，每配方每材料计一次；命中商人货名单者流通分归零。
- 数值对照采用重算前后全量快照（`Item.itemId / turnoverScore / isVendorItem` 按 item_id 排序）+ 逐 itemId 只读查询。

## 2. 缺口明细（2 条，均已补齐）

| itemId | 名称 | 专业 | 子类 | 站方材料 | before 分数 | after 分数 |
|---:|---|---|---|---|---:|---:|
| 4365 | 劣质炸药（Coarse Dynamite） | Engineering | 消耗品/爆炸物 | 4364 粗制火药粉×3 + 2589 亚麻布×1 | 4364=15，2589=0(误归零) | 4364=**16**，2589=**13** |
| 274048 | 9-60电池组（9-60 Battery Pack） | Engineering | 消耗品/其它 | 249409 天蓝染料×1 + 249391 黄铁矿×1 + 3575 铁锭×1 | 249391=20，3575=44，249409=0(染料设计) | 249391=**21**，3575=**45**，249409=0(染料设计，is_vendor_item=1) |

- 4365：本地同名 craft「劣质炸药」产出的是 **4358**（材料 4357 劣质火药×? + 2589），材料集合与站方 4365（4364 粗制火药粉）不一致，故不能复用，单独录入 `forever-consumables.json`。
- 274048：本地无任何同名/产出配方，单独录入。
- 249409 天蓝染料名称以「染料」结尾，命中 `/染料$/` 商人正则，按设计保持流通分 0、`is_vendor_item=1`（非缺口）。

## 3. 误标商人货修正（6 条生效 + 2 条顺手清理）

`compute-turnover.ts` 的 `VENDOR_ITEM_IDS` / `VENDOR_NAME_PATTERNS` 存在 id 错位与正则误伤，导致下列非商人货材料被强制归零（`is_vendor_item=1`、流通分=0）。本次从归零名单移除。

| itemId | 真实名称 | 误标来源 | 被多少配方当材料 | before | after |
|---:|---|---|---|---:|---:|
| 2589 | 亚麻布（布料，非商人） | VENDOR_ITEM_IDS 误标（原注释错写"红色染料"） | 12 本地 + 1 新增 4365 | 0 (vendor) | **13** |
| 2592 | 毛料（布料，非商人） | VENDOR_ITEM_IDS 误标 | 15 | 0 (vendor) | **15** |
| 3713 | 舒心草（草药，非商人） | VENDOR_ITEM_IDS 误标 | 32 | 0 (vendor) | **32** |
| 10940 | 奇异之尘（附魔分解产物，非商人） | VENDOR_ITEM_IDS 误标（原注释自相矛盾写"不是商人，跳过"） | 32 本地 + 20 附魔 | 0 (vendor) | **47** |
| 12808 | 死灵精华（世界掉落，非商人） | VENDOR_ITEM_IDS 误标 | 9 本地 + 5 附魔 | 0 (vendor) | **14** |
| 18256 | 灌魔之瓶（炼金**制造品**，非商人） | `/瓶$/` 正则误伤 | 18 本地 | 0 (vendor) | **18** |
| 3373 | 碎料护腕（护甲，id 错位） | VENDOR_ITEM_IDS 误标（无配方使用） | 0 | — | 顺手移除 |
| 2576 | 白色亚麻衬衣（裁缝制造品，id 错位） | VENDOR_ITEM_IDS 误标（无配方使用） | 0 | — | 顺手移除 |

> 注：10940 奇异之尘一行的「32 本地 + 20 附魔」为去重前计数；按脚本图纸/成品材料合并口径，本地实际计 27 条，27 + 20 附魔 = 47，与 after 分数 47 一致。

保留在 `VENDOR_ITEM_IDS` 的真商人货已把注释更正为真实名称：3371 空瓶、3372 铅瓶、8925 水晶瓶、2320 粗线、2594 壶装矮人蜜酒、2604 红色染料、2605 绿色染料、6260 蓝色染料、3857 煤块、4289 盐、2678 甜香料、159 清凉的泉水、1708 蜂蜜饮料、3466 强效助熔剂、14341 符文线、4291 丝线、8343 粗丝线；2588、1463 无数据且从不作为材料，保持不动。`VENDOR_NAME_PATTERNS` 仅删除 `/瓶$/`（三个真商人瓶 3371/3372/8925 已按 id 捕获），其余染料/线/面粉/香料/泉水/煤块正则保留。

## 4. 爆炸物专项结论

- 爆炸物共 112 件：**40 件站方可制造、39 件已覆盖、1 件缺口（=4365 劣质炸药）、72 件不可制造**。
- 本次补齐 4365 后，爆炸物可制造覆盖率 39→40/40，缺口清零。
- 用户示例复核：**16040 奥术炸弹**由 Engineering 配方覆盖，材料 16006 精密奥金转换器=**9**、12359 瑟银锭=**134**、14047 符文布=**27**，本次重算后三项分数保持不变（未受影响）。

## 5. 修复前后对比

| 指标 | Before | After1 | After2 |
|---|---:|---:|---:|
| Item 总行数 | 2866 | 2866 | 2866 |
| turnover_score > 0 计数 | 490 | **496** | 496 |
| is_vendor_item = 1 计数 | 35 | **29** | 29 |
| 计入流通分的材料种类数（freq.size） | 525 | 525 | 525 |
| 快照 sha256 | `D11703D7D8837E6F05521E3B3611D53E44A079CB19616A5364BCF2A381D01551` | `B8B7048F91D10387877BD953DA73450DE8F2CCFC7BFAF75DE1D0D9328F57A9EB` | `B8B7048F91D10387877BD953DA73450DE8F2CCFC7BFAF75DE1D0D9328F57A9EB` |

- scored>0 净增 6、vendor 净减 6，正好对应 6 项误标材料（2589/2592/3713/10940/12808/18256）从"商人归零"恢复为真实计数；新增的 2 条消耗品配方所用材料本就在 freq 内，未新增材料种类。

## 6. 幂等与回归验证

- **幂等**：连续两次重算后导出 After1 / After2 全量快照，sha256 逐字节一致（均为 `B8B7048F…7A9EB`），脚本可重复运行。
- **类型**：`npx tsc --noEmit` → exit 0，0 错误。
- **测试**：`npx vitest run` → **28 文件 / 189 用例全部通过**（与基线持平，未减少）。

## 7. 可复现脚本与备份

| 文件 | 作用 |
|---|---|
| `scripts/data/forever-consumables.json` | 新建：本地缺失的 2 条消耗品制造配方（4365、274048） |
| `scripts/compute-turnover.ts` | 修改：新增加载 forever-consumables.json；移除 7 个误标 VENDOR id 并更正注释；删除 `/瓶$/`；更新文件头 |
| `docs/archive/.tmp-turnover-snapshot.mjs` | 辅助：导出全量 Item(turnoverScore/isVendorItem) 快照 |
| `docs/archive/.tmp-turnover-before.json` / `.tmp-turnover-after1.json` / `.tmp-turnover-after2.json` | 重算前后快照及 sha256 |
| `docs/archive/.tmp-verify-turnover.mjs` | 辅助：逐 itemId 对照预期分数（13 项全 PASS） |
| `docs/archive/.tmp-probe-vendor.mjs` | 辅助：只读探测 itemId 真实名称与分数 |

- 重算命令：`npx tsx scripts/compute-turnover.ts`。
- **备份**：`prisma/dev.db.bak-20261001-consumables`，大小 **97,095,680 字节（≈97MB）**，与原件 `prisma/dev.db` 大小一致；本次未改未删该备份。

## 8. 未改动清单与只读声明

- 本次仅写/改：`prisma/dev.db.bak-20261001-consumables`（备份）、`scripts/data/forever-consumables.json`（新建）、`scripts/compute-turnover.ts`（修改）、本报告 `docs/reports/consumables-turnover-audit.md`（新建）、`docs/archive/.tmp-turnover-*.json` 快照及 `docs/archive/` 下 `.tmp-` 前缀辅助脚本。
- **未改动**：`src/`、`scripts/data/` 下其他数据文件（含 `wx-recipes.json`、`forever-enchants.json`、`gap-consumables*.json`）、任何既有 `.tmp-*` 文件、测试文件；除 `Item.turnoverScore` / `Item.isVendorItem` 及脚本既有占位 upsert 外未写其他表；未 git 提交/推送；未 kill 任何进程。
- 探测与数值核对全程只读；唯一写库行为来自 `compute-turnover.ts` 自身的全量重算。
