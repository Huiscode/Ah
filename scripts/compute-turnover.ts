/**
 * 计算物品流通分（turnover score）。
 *
 * 流通分 = 该物品作为材料被多少个配方使用。分数越高表示需求越广、
 * 在拍卖行周转越快。数据源：
 *   - Recipe 表（插件 /wahrecipes 扫上来的配方，覆盖炼金/锻造/附魔/
 *     工程/制皮/裁缝/烹饪/急救/钓鱼）；
 *   - scripts/data/forever-enchants.json（ForeverChanges 抓取的装备附魔
 *     配方 165 个 + 本地配方库缺失的附魔制造配方，均为无物品产出或
 *     本地缺失的配方，单独维护避免污染 Recipe 表）；
 *   - scripts/data/forever-consumables.json（本地 Recipe 缺失的消耗品
 *     制造配方，如工程「劣质炸药 4365」「9-60电池组 274048」，材料按
 *     itemId 计入流通分，与 Recipe 表同一口径）。
 *
 * 同时标记 NPC 商人常驻出售的容器/耗材（空瓶、铅瓶、水晶瓶、染料、
 * 粗线、丝线等）——这些物品拍卖行价不会超过 NPC 价，不适合捡漏，
 * 且流通分归零（货源是 NPC，流通分没有业务意义）。
 *
 * 2026-10-01 修正（消耗品覆盖审计，见 docs/consumables-turnover-audit.md）：
 *   - VENDOR_ITEM_IDS 移除 7 个误标 id：2589 亚麻布、2592 毛料、3713 舒心草、
 *     10940 奇异之尘、12808 死灵精华、3373 碎料护腕、2576 白色亚麻衬衣
 *     （均非商人货，此前被错误归零）；保留项注释更正为真实名称。
 *   - VENDOR_NAME_PATTERNS 删除 /瓶$/（真商人瓶 3371/3372/8925 已按 id
 *     捕获；灌魔之瓶 18256 为炼金制造品，不应归零）。
 *
 * 可重复运行：每次全量重算 turnoverScore 并重置 isVendorItem，幂等。
 * foreverchanges.pro 补完露营等专业后，把新配方写入 Recipe 表、
 * forever-enchants.json 或 forever-consumables.json，再跑一次本脚本即可更新流通分。
 */
import { PrismaClient } from "@prisma/client";
import * as fs from "node:fs";
import * as path from "node:path";

const p = new PrismaClient();

// ForeverChanges 附魔配方（装备附魔 165 + 本地缺失的附魔制造配方），
// 材料按 itemId 计入流通分，与 Recipe 表材料同一口径（每配方计一次）。
const ENCHANT_DATA_PATH = path.join(process.cwd(), "scripts", "data", "forever-enchants.json");
type EnchantData = {
  enchants: Array<{ name: string; reagents: Array<{ id: number; count: number; name: string }> }>;
  craftedMissing: Array<{ name: string; reagents: Array<{ id: number; count: number; name: string }> }>;
};
function loadEnchantData(): EnchantData | null {
  try {
    return JSON.parse(fs.readFileSync(ENCHANT_DATA_PATH, "utf8")) as EnchantData;
  } catch (e) {
    console.warn(`  无法读取 ${ENCHANT_DATA_PATH}（${(e as Error).message}），跳过附魔配方。`);
    return null;
  }
}

// ForeverChanges 消耗品制造配方（本地 Recipe 缺失的有产出消耗品配方，
// 如工程「劣质炸药 4365」「9-60电池组 274048」），材料按 itemId 计入
// 流通分，与 Recipe 表材料同一口径（每配方计一次）。
const CONSUMABLE_DATA_PATH = path.join(process.cwd(), "scripts", "data", "forever-consumables.json");
type ConsumableData = {
  consumables: Array<{
    name: string;
    profession: string;
    outputId: number;
    reagents: Array<{ id: number; count: number; name: string }>;
  }>;
};
function loadConsumableData(): ConsumableData | null {
  try {
    return JSON.parse(fs.readFileSync(CONSUMABLE_DATA_PATH, "utf8")) as ConsumableData;
  } catch (e) {
    console.warn(`  无法读取 ${CONSUMABLE_DATA_PATH}（${(e as Error).message}），跳过消耗品配方。`);
    return null;
  }
}

// 常驻商人出售的容器/耗材（itemId 或名字关键词）。
// 这些在各大主城商业用品商人处几个铜币一个，AH 价天花板就是 NPC 价。
const VENDOR_ITEM_IDS = new Set<number>([
  3371, // 空瓶
  3372, // 铅瓶
  8925, // 水晶瓶
  2320, // 粗线
  2594, // 壶装矮人蜜酒
  2604, // 红色染料
  2605, // 绿色染料
  6260, // 蓝色染料
  3857, // 煤块
  4289, // 盐
  2678, // 甜香料
  159, // 清凉的泉水
  1708, // 蜂蜜饮料
  3466, // 强效助熔剂
  14341, // 符文线
  4291, // 丝线（裁缝用品商人常驻出售）
  8343, // 粗丝线（裁缝用品商人常驻出售）
  2588, // 无数据且从不作为材料，保持不动
  1463, // 无数据且从不作为材料，保持不动
  2590, // 森林蜘蛛网（保留原 id；从不作为材料，不影响流通分）
  2595, // 罐装荒芜之地波本酒（保留原 id；从不作为材料，不影响流通分）
]);

const VENDOR_NAME_PATTERNS = [
  /^墨囊$/,
  /^细线$/,
  /线团$/,
  /染料$/,
  /^面粉$/,
  /^香料$/,
  /泉水$/,
  /^木料$/,
  /^石头$/,
  /^燧石$/,
  /^煤块$/,
];

function isVendorItem(name: string, itemId: number): boolean {
  if (VENDOR_ITEM_IDS.has(itemId)) return true;
  return VENDOR_NAME_PATTERNS.some((re) => re.test(name));
}

async function main() {
  // 1. 统计每个 itemId 被多少配方当材料用
  const recipeCount = await p.recipe.count();
  console.log(`Scoring ${recipeCount} recipes...`);

  // 1a. 去重：本地配方库把"图纸配方"和"成品配方"作为两个配方收录
  //     （如「公式：微光法杖」与「微光法杖」材料相同），本质是同一制造
  //     配方，按每配方计一次的口径应合并。规则：同专业存在「公式：X」
  //     （或 Formula: X）与成品「X」，且材料 itemId 集合相同、非空 →
  //     跳过图纸配方，只统计成品配方；无成品的图纸配方（如公式：雷霆图腾）
  //     正常统计。
  const recipes = await p.recipe.findMany({ select: { name: true, profession: true, reagents: true } });
  type ReagentsRow = Array<{ itemId: number; name: string }>;
  const matSignature = (reagents: unknown): string => {
    const ids = new Set<number>();
    for (const r of (reagents as ReagentsRow) ?? []) if (r?.itemId) ids.add(r.itemId);
    return [...ids].sort((a, b) => a - b).join(",");
  };
  const stripFormulaPrefix = (name: string): { isFormula: boolean; base: string } => {
    const zh = name.match(/^公式[：:]\s*(.+)$/);
    if (zh) return { isFormula: true, base: zh[1].trim() };
    const en = name.match(/^Formula:\s*(.+)$/i);
    if (en) return { isFormula: true, base: en[1].trim() };
    return { isFormula: false, base: name.trim() };
  };
  // 非图纸配方按 (专业, 名) 索引材料签名
  const prodSigs = new Map<string, Set<string>>();
  for (const r of recipes) {
    const { isFormula } = stripFormulaPrefix(r.name);
    if (isFormula) continue;
    const sig = matSignature(r.reagents);
    if (!sig) continue;
    const key = `${r.profession}\u0000${r.name.trim()}`;
    if (!prodSigs.has(key)) prodSigs.set(key, new Set());
    prodSigs.get(key)!.add(sig);
  }
  const skipNames = new Set<string>();
  let mergedPairs = 0;
  for (const r of recipes) {
    const { isFormula, base } = stripFormulaPrefix(r.name);
    if (!isFormula) continue;
    const sig = matSignature(r.reagents);
    if (!sig) continue;
    const key = `${r.profession}\u0000${base}`;
    const sigs = prodSigs.get(key);
    if (sigs && sigs.has(sig)) {
      skipNames.add(r.name);
      mergedPairs++;
    }
  }
  console.log(`  Dedup: ${mergedPairs} 图纸配方与成品配方材料相同，合并统计`);

  const freq = new Map<number, { name: string; count: number }>();
  for (const r of recipes) {
    if (skipNames.has(r.name)) continue;
    const reagents = r.reagents as ReagentsRow;
    if (!Array.isArray(reagents)) continue;
    const seenInRecipe = new Set<number>();
    for (const reg of reagents) {
      if (!reg?.itemId || seenInRecipe.has(reg.itemId)) continue;
      seenInRecipe.add(reg.itemId);
      const cur = freq.get(reg.itemId);
      if (cur) cur.count++;
      else freq.set(reg.itemId, { name: reg.name, count: 1 });
    }
  }

  // 1b. 合并 ForeverChanges 附魔配方（装备附魔无物品产出、本地缺失的
  //     附魔制造配方），同一口径：每个配方里每种材料计一次。
  const enchantData = loadEnchantData();
  let enchantRecipes = 0;
  if (enchantData) {
    const extraRecipes = [...enchantData.enchants, ...enchantData.craftedMissing];
    enchantRecipes = extraRecipes.length;
    for (const r of extraRecipes) {
      const seenInRecipe = new Set<number>();
      for (const reg of r.reagents ?? []) {
        if (!reg?.id || seenInRecipe.has(reg.id)) continue;
        seenInRecipe.add(reg.id);
        const cur = freq.get(reg.id);
        if (cur) cur.count++;
        else freq.set(reg.id, { name: reg.name, count: 1 });
      }
    }
  }
  console.log(`  + ${enchantRecipes} enchant recipes from forever-enchants.json`);

  // 1c. 合并 ForeverChanges 消耗品制造配方（本地 Recipe 缺失的有产出消耗品
  //     配方，如工程「劣质炸药 4365」「9-60电池组 274048」），同一口径：
  //     每个配方里每种材料计一次。
  const consumableData = loadConsumableData();
  let consumableRecipes = 0;
  if (consumableData) {
    const extraRecipes = consumableData.consumables ?? [];
    consumableRecipes = extraRecipes.length;
    for (const r of extraRecipes) {
      const seenInRecipe = new Set<number>();
      for (const reg of r.reagents ?? []) {
        if (!reg?.id || seenInRecipe.has(reg.id)) continue;
        seenInRecipe.add(reg.id);
        const cur = freq.get(reg.id);
        if (cur) cur.count++;
        else freq.set(reg.id, { name: reg.name, count: 1 });
      }
    }
  }
  console.log(`  + ${consumableRecipes} consumable recipes from forever-consumables.json`);
  console.log(`Materials used in recipes: ${freq.size}`);

  // 2. 重置所有物品的 turnoverScore / isVendorItem
  await p.item.updateMany({ data: { turnoverScore: 0, isVendorItem: false } });

  // 3. 按 itemId upsert；物品不在 Item 表的先建一条占位记录。
  //    商人常驻出售的普通耗材（isVendorItem=true）流通分归零——
  //    它们货源是 NPC、AH 价被商人价封顶，流通分没有业务意义。
  let upserted = 0;
  for (const [itemId, info] of freq) {
    const vendor = isVendorItem(info.name, itemId);
    const score = vendor ? 0 : info.count;
    await p.item.upsert({
      where: { itemId },
      create: {
        itemId,
        name: info.name,
        quality: "common",
        category: "材料",
        subCategory: "未知",
        turnoverScore: score,
        isVendorItem: vendor,
      },
      update: {
        turnoverScore: score,
        isVendorItem: vendor,
        // 如果之前名字缺失，补上
        name: info.name,
      },
    });
    upserted++;
  }
  console.log(`Upserted ${upserted} materials with turnover score.`);

  // 4. 打印 Top 20 高分物品（流通最快）
  const top = [...freq.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20);
  console.log("\nTop 20 materials by turnover score:");
  for (const [id, info] of top) {
    const vendor = isVendorItem(info.name, id) ? " [NPC]" : "";
    const score = vendor ? 0 : info.count;
    console.log(`  ${score.toString().padStart(3)}  ${info.name} (${id})${vendor}`);
  }

  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
