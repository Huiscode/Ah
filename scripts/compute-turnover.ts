/**
 * 计算物品流通分（turnover score）。
 *
 * 流通分 = 该物品作为材料被多少个配方使用。分数越高表示需求越广、
 * 在拍卖行周转越快。数据源：Recipe 表（插件 /wahrecipes 扫上来的
 * 2262 个配方，覆盖炼金/锻造/附魔/工程/制皮/裁缝/烹饪/急救/钓鱼）。
 *
 * 同时标记 NPC 商人常驻出售的容器/耗材（空瓶、铅瓶、水晶瓶、染料、
 * 细线等）——这些物品拍卖行价不会超过 NPC 价，不适合捡漏。
 *
 * 可重复运行：每次全量重算 turnoverScore 并重置 isVendorItem，幂等。
 * 以后 foreverchanges.pro 补完露营等专业后，把新配方写入 Recipe 表，
 * 再跑一次本脚本即可更新流通分。
 */
import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

// 常驻商人出售的容器/耗材（itemId 或名字关键词）。
// 这些在各大主城商业用品商人处几个铜币一个，AH 价天花板就是 NPC 价。
const VENDOR_ITEM_IDS = new Set<number>([
  3371, // 空瓶
  3372, // 铅瓶
  8925, // 水晶瓶
  3713, // 墨囊
  2320, // // 细线
  2592, // 细小羊毛线团
  2589, // 红色染料
  2590, // 蓝色染料
  2594, // 黄色染料
  2595, // 绿色染料
  3857, // 黑色染料
  4289, // 棕色染料
  2605, // 橙色染料
  2604, // 紫色染料
  3373, // 煤块
  2678, // 木料
  6260, // 石头
  10940, // 强效魔法精华（不是商人，跳过）
  159, // 面粉
  2588, // 香料
  1708, // 清凉的泉水
  12808, // 冰水
  1463, // 辣椒
  3466, // 燧石
  2576, // 弱效符文带
  14341, // 符文线
]);

const VENDOR_NAME_PATTERNS = [
  /瓶$/,
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

  const freq = new Map<number, { name: string; count: number }>();
  const recipes = await p.recipe.findMany({ select: { reagents: true } });
  for (const r of recipes) {
    const reagents = r.reagents as Array<{ itemId: number; name: string }>;
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
  console.log(`Materials used in recipes: ${freq.size}`);

  // 2. 重置所有物品的 turnoverScore / isVendorItem
  await p.item.updateMany({ data: { turnoverScore: 0, isVendorItem: false } });

  // 3. 按 itemId upsert；物品不在 Item 表的先建一条占位记录
  let upserted = 0;
  for (const [itemId, info] of freq) {
    const vendor = isVendorItem(info.name, itemId);
    await p.item.upsert({
      where: { itemId },
      create: {
        itemId,
        name: info.name,
        quality: "common",
        category: "材料",
        subCategory: "未知",
        turnoverScore: info.count,
        isVendorItem: vendor,
      },
      update: {
        turnoverScore: info.count,
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
    console.log(`  ${info.count.toString().padStart(3)}  ${info.name} (${id})${vendor}`);
  }

  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
