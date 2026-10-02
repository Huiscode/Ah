import { RadioTower } from "lucide-react";
import Link from "next/link";
import { buildFloorPriceIndex, computeRecipeProfits } from "@/lib/recipe-profits";
import { getItemVendorPrices, getRecipes } from "@/lib/repositories";
import { getMarketSignals } from "@/lib/market-signals";
import { describeFreshness } from "@/lib/freshness";
import { RecipeLibrary } from "@/components/recipe-library";
import { Panel, PanelHeader } from "@/components/ui/panel";

export const dynamic = "force-dynamic";

// 配方库（独立页面）：无限服（WoW Forever）全量制造配方与商人青睐兑换，
// 数据源 wx-wow.com —— 社区对客户端 DB2 的挖掘（build 1.60.1.69913），与
// 游戏内 /wahrecipes 扫描合并（客户端 1.60.1，以游戏内实装为准）。专业配方
// 12 专业 1947 条（附魔等无物品产出的配方不在列），商人青睐兑换 320 条
// （材料+青睐货币 → 成品）。价格口径与首页制造利润一致：实时 AH 价（自扫P10→
// 网站P50 按最新来源）优先，NPC 保底价兜底；产出价扣 5% 拍卖税后按利润率
// 排序。游戏内 /wahrecipes 扫描的新配方会自动并入专业配方分类（同名覆盖）。
// 配方/物品数量会随扫描与补录变化，以面板"统计"卡片为准。
export default async function RecipesPage() {
  const [{ signals, latestSnapshotAt }, recipes, vendorPrices] = await Promise.all([
    getMarketSignals(),
    getRecipes(),
    getItemVendorPrices()
  ]);
  const freshness = describeFreshness(latestSnapshotAt, new Date());
  const priceByItemId = new Map(signals.map((signal) => [signal.itemId, signal.price]));
  const floorPriceIndex = buildFloorPriceIndex(recipes, vendorPrices);
  const recipeRows = computeRecipeProfits(recipes, priceByItemId, floorPriceIndex);
  const okCount = recipeRows.filter((row) => row.status === "ok").length;
  const craftCount = recipeRows.filter((row) => row.recipe.category !== "merchant").length;
  const merchantCount = recipeRows.length - craftCount;

  return (
    <main className="terminal-grid min-h-screen bg-terminal-bg p-3 text-slate-200">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border border-terminal-border bg-terminal-panel px-4 py-3">
        <div>
          <h1 className="font-mono text-lg font-semibold uppercase text-terminal-amber">配方库</h1>
          <p className="font-mono text-xs text-terminal-muted">无限服制造配方 · 专业分类 · 利润率排行</p>
        </div>
        <div className="flex items-center gap-3 font-mono text-xs text-terminal-muted">
          <span className={freshness.stale ? "flex items-center gap-1 text-terminal-red" : "flex items-center gap-1 text-terminal-green"}>
            <RadioTower size={14} /> 市场数据更新于 {freshness.label}
          </span>
          <Link href="/" className="text-terminal-amber hover:underline">← 返回终端</Link>
        </div>
      </div>

      <div className="mb-3 grid gap-3 font-mono text-[10px] leading-relaxed text-terminal-muted md:grid-cols-3">
        <Panel>
          <PanelHeader title="口径" />
          <div className="p-3">
            产出收入 = 实时 AH 价（自扫P10 → 网站P50，按最新来源自动选）或 NPC 保底价兜底，再扣 5% 拍卖税。材料成本同口径。商人兑换的"青睐"货币成本无法折算铜币，未计入成本。
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="来源" />
          <div className="p-3">
            wx-wow.com 无限服数据库（build 1.60.1.69913）+ 游戏内 /wahrecipes 扫描（客户端 1.60.1，以游戏内实装为准）：专业配方 {craftCount} 条 + 商人青睐兑换 {merchantCount} 条。游戏内 /wahrecipes 扫描的配方自动并入专业配方。
          </div>
        </Panel>
        <Panel>
          <PanelHeader title="统计" />
          <div className="p-3">
            共 {recipes.length} 条 · 当前可算利润 {okCount} 条 · 缺价 {recipes.length - okCount} 条。附魔等无物品产出的配方不在此列。
          </div>
        </Panel>
      </div>

      <RecipeLibrary rows={recipeRows} />
      <footer className="mt-3 border border-terminal-border bg-terminal-panel px-4 py-2 font-mono text-[10px] leading-relaxed text-terminal-muted">
        配方数据来自 wx-wow.com 无限服数据库（build 1.60.1.69913）与游戏内 /wahrecipes 扫描（客户端 1.60.1，非官方公布，以游戏内实装为准）。商人兑换的"青睐"货币成本按业绩奖励累积，未折算铜币。价格实时性取决于市场数据：无 AH 挂单时以 NPC 收购价兜底计算，仅作参考下限。
      </footer>
    </main>
  );
}
