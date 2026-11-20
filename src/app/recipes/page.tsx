import { RadioTower } from "lucide-react";
import { buildRecipeFloors, computeRecipeProfits } from "@/lib/recipe-profits";
import { getItemSellerPrices, getItemVendorPrices, getItemNames, getRecipes, getScrollItemIds, getShoppingLists } from "@/lib/repositories";
import { getMarketSignals } from "@/lib/market-signals";
import { AUCTIONATOR_STALE_MAX_AGE_MS, describeFreshness } from "@/lib/freshness";
import { RecipeLibrary } from "@/components/recipe-library";
import { CloseTabButton } from "@/components/close-tab-button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { parseServer, serverLabel } from "@/lib/servers";
import { L } from "@/lib/i18n";
import { getLang } from "@/lib/i18n-server";
import { LangToggle } from "@/components/lang-toggle";
import { buildItemNameIndex, localizeRecipeProfitRow } from "@/lib/recipe-i18n";
import Link from "next/link";

export const dynamic = "force-dynamic";

// 配方库（独立页面）：无限服（WoW Forever）全量制造配方与商人青睐兑换。
// 专业配方 12 专业 + 商人青睐兑换。价格口径与首页制造利润一致：实时 AH 价
// （Auctionator 最低买入价）优先，NPC 保底价兜底；材料成本兜底优先用 NPC
// 卖价（Item.sellPrice），其次收购价；产出价扣 5% 拍卖税后按利润率排序。
// 拍卖行无价/无记录的配方标注"缺货"，扫到后自动补齐。
export default async function RecipesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const server = parseServer(raw.server);
  const lang = await getLang();
  const serverLabelText = serverLabel(server, lang);
  const [{ signals, latestSnapshotAt }, recipes, vendorPrices, sellerPrices, scrollItemIds, shoppingLists, itemNames] = await Promise.all([
    getMarketSignals("faction", "current", server),
    getRecipes(),
    getItemVendorPrices(),
    getItemSellerPrices(),
    getScrollItemIds(),
    getShoppingLists(),
    getItemNames()
  ]);
  const nameIndex = buildItemNameIndex(itemNames);
  const listOptions = shoppingLists.map((list) => ({ id: list.id, name: list.name }));
  const freshness = describeFreshness(latestSnapshotAt, new Date(), AUCTIONATOR_STALE_MAX_AGE_MS, lang);
  const priceByItemId = new Map(signals.map((signal) => [signal.itemId, signal.price]));
  const floors = buildRecipeFloors(recipes, vendorPrices, sellerPrices);
  const recipeRows = computeRecipeProfits(recipes, priceByItemId, floors.costFloor, floors.revenueFloor, scrollItemIds)
    .map((row) => localizeRecipeProfitRow(row, nameIndex, lang));
  const okCount = recipeRows.filter((row) => row.status === "ok").length;
  const craftCount = recipeRows.filter((row) => row.recipe.category !== "merchant").length;
  const merchantCount = recipeRows.length - craftCount;

  return (
    <main className="terminal-grid min-h-screen bg-terminal-bg p-3 text-slate-200">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border border-terminal-border bg-terminal-panel px-4 py-3">
        <div>
          <h1 className="font-mono text-lg font-semibold uppercase text-terminal-amber">{L(lang, "Recipes", "配方库")}</h1>
          <p className="font-mono text-xs text-terminal-muted">{L(lang, "Forever-craft recipes · by profession · profit ranking", "无限服制造配方 · 专业分类 · 利润率排行")}</p>
        </div>
        <div className="flex items-center gap-3 font-mono text-xs text-terminal-muted">
          <span className={freshness.stale ? "flex items-center gap-1 text-terminal-red" : "flex items-center gap-1 text-terminal-green"}>
            <RadioTower size={14} /> {serverLabelText}·{L(lang, "market updated", "市场数据更新于")} {freshness.label}
          </span>
          <LangToggle lang={lang} />
          <CloseTabButton />
        </div>
      </div>

      {signals.length === 0 && (
        <div className="mb-3 border border-terminal-amber/50 bg-amber-500/10 px-4 py-2 font-mono text-xs text-terminal-amber">
          {L(lang, "No market data on this server yet — profit calc unavailable (the recipe library itself is shared across servers and browsable). Run a full Auctionator scan in game, then re-run the import.", "本服务器暂无市场数据 —— 利润计算不可用（配方本身跨服共享，可正常浏览）。请在游戏内用 Auctionator 全量扫描拍卖行后重跑导入。")}
        </div>
      )}

      <div className="mb-3 grid gap-3 font-mono text-[10px] leading-relaxed text-terminal-muted md:grid-cols-3">
        <Panel>
          <PanelHeader title={L(lang, "Method", "口径")} />
          <div className="p-3">
            {L(lang,
              "Output revenue = live AH lowest buyout (Auctionator) or the NPC floor, minus the 5% AH cut. Material costs use the same basis. The merchant-exchange Favor currency has no copper conversion and is excluded from cost. Priceless/unlisted items are marked \"no stock\".",
              "产出收入 = 实时拍卖行最低买入价（Auctionator）或 NPC 保底价兜底，再扣 5% 拍卖税。材料成本同口径。商人兑换的\"青睐\"货币成本无法折算铜币，未计入成本。无价/无记录标注\"缺货\"。")}
          </div>
        </Panel>
        <Panel>
          <PanelHeader title={L(lang, "Sources", "来源")} />
          <div className="p-3">
            {L(lang,
              `Recipe sources = foreverchanges.pro profession pages cross-checked + in-game /wahrecipes dumps (client 1.60.1, in-game truth wins): ${craftCount} craft recipes + ${merchantCount} merchant-favor exchanges. Item/recipe names are continuously backfilled from foreverchanges.pro.`,
              `配方库来源 = foreverchanges.pro 专业页核对 + 游戏内 /wahrecipes 扫描（客户端 1.60.1，以游戏内实装为准）：专业配方 ${craftCount} 条 + 商人青睐兑换 ${merchantCount} 条。物品名/配方由 foreverchanges.pro 数据源持续补全。`)}
          </div>
        </Panel>
        <Panel>
          <PanelHeader title={L(lang, "Stats", "统计")} />
          <div className="p-3">
            {signals.length === 0
              ? L(lang, `${recipes.length} total · no market data on this server yet, profit calc unavailable (recipes still browsable).`, `共 ${recipes.length} 条 · 本服务器暂无市场数据，利润计算不可用（配方可正常浏览）。`)
              : L(lang, `${recipes.length} total · ${okCount} with computable profit · ${recipeRows.filter((row) => row.status === "cost-only").length} cost-only (enchant-style, no item output) · ${recipeRows.filter((row) => row.status === "missing").length} missing price.`,
                `共 ${recipes.length} 条 · 当前可算利润 ${okCount} 条 · 附魔等无物品产出配方另计 ${recipeRows.filter((row) => row.status === "cost-only").length} 条（仅看材料成本）· 缺货 ${recipeRows.filter((row) => row.status === "missing").length} 条。`)}
          </div>
        </Panel>
      </div>

      <RecipeLibrary rows={recipeRows} lists={listOptions} marketAvailable={signals.length > 0} />
      <footer className="mt-3 border border-terminal-border bg-terminal-panel px-4 py-2 font-mono text-[10px] leading-relaxed text-terminal-muted">
        {L(lang,
          "Recipe data from foreverchanges.pro profession pages and in-game /wahrecipes dumps (client 1.60.1; unofficial, in-game truth wins). Merchant Favor costs accrue as performance rewards and are not converted to copper. Price basis = Auctionator lowest buyout; with no AH listing the NPC buy price floors the estimate (reference lower bound only). Missing-price recipes resume automatically once scanned/backfilled.",
          "配方数据来自 foreverchanges.pro 专业页核对与游戏内 /wahrecipes 扫描（客户端 1.60.1，非官方公布，以游戏内实装为准）。商人兑换的\"青睐\"货币成本按业绩奖励累积，未折算铜币。价格口径 = Auctionator 最低买入价：无 AH 挂单时以 NPC 收购价兜底计算，仅作参考下限；缺货配方待扫描/数据源补全后自动恢复计算。")}
      </footer>
    </main>
  );
}
