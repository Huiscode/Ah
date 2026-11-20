// 补档目标清单生成（2026-11-19）：把"需要前五档价格档位"的精确物品清单从网页端
// 下发给插件（TierList.lua），替代插件端按价格历史的粗略候选猜测。
//
// 清单 = 中间材料利润物品（全部）+ 雷达池按利润排序的前 K 个捡漏/必赚
// （K 默认 150，环境变量 TIER_TOP_K 覆盖）。插件端只搜这份名单（交集当前在售 +
// 新鲜度门槛），~200 个 × 0.2s ≈ 1 分钟内完成。
//
// 跑法：npm run gen:tierlist（手动）；watch-auto-import 每轮导入后自动执行。
// 输出：addon-auctionator\Source_Forever\TierList.lua（受控副本，随 robocopy 同步游戏），
// 并直接复制到游戏目录（游戏目录路径从 AQ_AUCTIONATOR_SV_PATH 推导）。
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDealRadar } from "@/lib/analytics";
import { buildRecipeFloors } from "@/lib/recipe-profits";
import { buildSecondaryMaterialRows } from "@/lib/secondary-materials";
import { mergeRadarRules } from "@/lib/market-rules";
import { getMarketSignals } from "@/lib/market-signals";
import { getRadarRules, getRecipes, getItemVendorPrices, getItemSellerPrices } from "@/lib/repositories";

process.loadEnvFile();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOP_K = Number(process.env.TIER_TOP_K ?? 150);

async function main() {
  const [{ signals }, recipes, vendorPrices, sellerPrices, ruleOverrides] = await Promise.all([
    getMarketSignals("faction", "current", "eu"),
    getRecipes(),
    getItemVendorPrices(),
    getItemSellerPrices(),
    getRadarRules()
  ]);
  const radarRules = mergeRadarRules(ruleOverrides);

  // 1) 中间材料利润物品（全部，~50 个）
  const priceByItemId = new Map(signals.map((s) => [s.itemId, s.price]));
  const floors = buildRecipeFloors(recipes, vendorPrices, sellerPrices);
  const secondaryRows = buildSecondaryMaterialRows(recipes, priceByItemId, floors.costFloor, floors.revenueFloor);
  const ids = new Set<number>(secondaryRows.map((r) => r.item.itemId));

  // 2) 雷达池按利润排序的前 K：必赚（vendor 倒卖）与捡漏都按绝对利润降序
  const deals = buildDealRadar(signals, radarRules);
  const ranked = [...deals].sort((a, b) => b.profit - a.profit);
  for (const deal of ranked.slice(0, TOP_K)) ids.add(deal.itemId);

  const sorted = [...ids].sort((a, b) => a - b);
  const ts = Math.floor(Date.now() / 1000);
  const lines = sorted.map((id) => `  [${id}] = true,`);
  const lua = `-- 自动生成（scripts/gen-tier-list.ts）——补档目标清单：中间材料全部 + 雷达池利润前 ${TOP_K}。
-- 插件端 Transcript.lua 扫描完成后只对这份清单（∩ 当前在售 ∩ 4h 新鲜度门槛）逐个搜索采集前五档。
-- 手动重生成：npm run gen:tierlist；watch 每轮导入后自动刷新。勿手改。
WAH_TIER_LIST = {
${lines.join("\n")}
}
WAH_TIER_LIST_TS = ${ts}
`;
  const repoFile = join(ROOT, "addon-auctionator", "Source_Forever", "TierList.lua");
  writeFileSync(repoFile, lua, "utf8");
  console.log(`生成 ${repoFile}: ${sorted.length} 个物品（中间材料 ${secondaryRows.length} + 雷达前 ${Math.min(TOP_K, ranked.length)}，去重后）`);

  // 直接复制到游戏目录（从存档路径推导 _forever_ 根）。.env 值里的 \\ 双反斜杠
  // 原样保留在字符串里（Windows 容忍），先归一化成单反斜杠再匹配。
  const sv = process.env.AQ_AUCTIONATOR_SV_PATH;
  if (sv) {
    const norm = sv.replace(/\\\\/g, "\\");
    const m = norm.match(/^(.*WTF[\\/])Account[\\/]/);
    if (m) {
      const gameDir = m[1].replace(/WTF[\\/]$/, "");
      const target = join(gameDir, "Interface", "AddOns", "Auctionator", "Source_Forever", "TierList.lua");
      try {
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(repoFile, target);
        console.log(`已同步游戏目录: ${target}`);
      } catch (e) {
        console.error(`同步游戏目录失败（不影响清单生成）：${(e as Error).message}`);
      }
    } else {
      console.error(`无法从存档路径推导游戏目录（未同步游戏端）：${norm}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
