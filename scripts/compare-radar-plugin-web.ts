// Compare the plugin's in-game radar (from SV points) with the web radar
// (from DB). The two must classify the same scan identically; run this after
// any reconcile or schema change to prove 0/0 diffs.
// Run: npx tsx scripts/compare-radar-plugin-web.ts
import { readFileSync } from "node:fs";
import { parseSavedVariables } from "../src/lib/addon-scan";
import { buildMarketSignal, buildDealRadar, type MarketSignal } from "../src/lib/analytics";
import { prisma } from "../src/lib/prisma";

const svPath = process.env.AQT_SAVEDVARS_PATH ?? "C:/Program Files (x86)/World of Warcraft/_classic_beta_/WTF/Account/1120133458#1/SavedVariables/WoWderhoiAH.lua";

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length / 2) - 1];
}

async function main() {
  const raw = parseSavedVariables(readFileSync(svPath, "utf8"));
  const db = raw.WoWderhoiAHDB as Record<string, unknown>;
  const scan = db.scanData as { scannedAt: number; items: Record<string, AddonEntry> };
  const points = (db.points ?? {}) as Record<string, Array<{ t: number; c: number; q?: number }>>;
  const radar = (db.settings as { radar?: PluginRadar }).radar!;
  console.log("SV scan.scannedAt:", scan.scannedAt, new Date(scan.scannedAt * 1000).toISOString());
  console.log("SV radar rules:", JSON.stringify(radar));
  console.log("SV scan items:", Object.keys(scan.items).length, "| SV point items:", Object.keys(points).length);

  // --- Plugin radar (Trade.lua refreshDeals, exact) ---
  const pluginDeals: Array<{ itemId: number; name: string; vendor: boolean; min: number; med7: number; profit: number; discount: number }> = [];
  for (const [itemIdStr, entry] of Object.entries(scan.items)) {
    const itemId = Number(itemIdStr);
    // Class 1 vendor
    if (entry.vendorP && entry.vendorP > 0 && entry.minPrice && entry.minPrice > 0 && entry.minPrice < entry.vendorP) {
      pluginDeals.push({ itemId, name: entry.name, vendor: true, min: entry.minPrice, med7: entry.vendorP, profit: entry.vendorP - entry.minPrice, discount: (1 - entry.minPrice / entry.vendorP) * 100 });
      continue;
    }
    const rawPts = points[itemIdStr];
    const pts = Array.isArray(rawPts) ? rawPts : Object.values((rawPts ?? {}) as Record<string, { t: number; c: number; q?: number }>);
    if (!pts.length || pts.length < radar.minHistory) continue;
    const closes = pts.map((p) => p.c);
    closes.sort((a, b) => a - b);
    const med7 = closes[Math.ceil(closes.length / 2) - 1];
    let distinct = 1;
    for (let i = 1; i < closes.length; i++) if (closes[i] !== closes[i - 1]) distinct++;
    if (!(med7 > 0 && entry.minPrice > 0 && (entry.numAuctions || 0) >= radar.minAuctions
      && med7 - entry.minPrice >= radar.minProfit
      && med7 - entry.minPrice >= med7 * radar.minProfitRatio
      && entry.minPrice <= med7 * radar.discount
      && distinct >= radar.minMed7Distinct
      && entry.minPrice >= med7 * (1 - radar.maxDiscount)
      && (!radar.supplyShrink || true)
      && ((radar.supplyCap ?? 0) <= 0 || (entry.quantity || 0) <= (radar.supplyCap ?? 0)))) continue;
    pluginDeals.push({ itemId, name: entry.name, vendor: false, min: entry.minPrice, med7, profit: med7 - entry.minPrice, discount: (1 - entry.minPrice / med7) * 100 });
  }
  console.log("PLUGIN radar (from SV):", pluginDeals.length);

  // --- Web radar (production path) ---
  const ruleRow = await prisma.radarRule.findUnique({ where: { id: 1 } });
  const rules = ruleRow ? (ruleRow.rules as unknown as Record<string, unknown>) : undefined;
  const items = await prisma.item.findMany({ include: { snapshots: { orderBy: { timestamp: "asc" } }, dailySummaries: { orderBy: { date: "asc" } } } });
  const now = new Date();
  const signals: MarketSignal[] = items.filter((i) => i.snapshots.length > 0).map((i) => buildMarketSignal(i, now));
  const allWebDeals = buildDealRadar(signals, rules as Parameters<typeof buildDealRadar>[1]);
  // Same universe rule as production: only items of the latest addon scan round.
  const latestAddon = await prisma.auctionSnapshot.findFirst({ where: { source: "addon" }, orderBy: { timestamp: "desc" }, select: { timestamp: true } });
  const currentRoundIds = latestAddon
    ? new Set((await prisma.auctionSnapshot.findMany({ where: { source: "addon", timestamp: latestAddon.timestamp }, select: { itemId: true } })).map((r) => r.itemId))
    : null;
  const webDeals = currentRoundIds === null ? allWebDeals : allWebDeals.filter((d) => currentRoundIds.has(d.itemId));
  console.log("WEB radar (from DB, current addon round only):", webDeals.length);

  const pluginIds = new Set(pluginDeals.map((d) => d.itemId));
  const webIds = new Set(webDeals.map((d) => d.itemId));
  const onlyPlugin = pluginDeals.filter((d) => !webIds.has(d.itemId));
  const onlyWeb = webDeals.filter((d) => !pluginIds.has(d.itemId));
  console.log("only in PLUGIN:", onlyPlugin.length, JSON.stringify(onlyPlugin.map((d) => ({ item: d.itemId, name: d.name, vendor: d.vendor }))));
  console.log("only in WEB:", onlyWeb.length, JSON.stringify(onlyWeb.map((d) => ({ item: d.itemId, name: d.name, vendor: d.vendor }))));

  // Why: for each only-plugin item, show plugin pts vs DB same-source 7d samples
  const webByItem = new Map(signals.map((s) => [s.itemId, s]));
  for (const d of onlyPlugin) {
    const ptsRaw = points[String(d.itemId)];
    const ptsArr = Array.isArray(ptsRaw) ? ptsRaw : Object.values((ptsRaw ?? {}) as Record<string, { t: number; c: number; q?: number }>);
    const sig = webByItem.get(d.itemId);
    console.log(`-- ${d.name}(${d.itemId}) vendor=${d.vendor}`);
    console.log(`   plugin: pts=${ptsArr.length ?? 0} med7=${d.med7} min=${d.min}`);
    if (sig) {
      console.log(`   web:    src=${sig.source} samples7d=${sig.med7Samples} distinct=${sig.med7Distinct} med7=${sig.med7} min=${sig.minPrice} auctions=${sig.numAuctions}`);
    } else {
      console.log(`   web:    NO SIGNAL (no snapshots or item missing)`);
    }
  }
  for (const d of onlyWeb) {
    const sig = webByItem.get(d.itemId)!;
    const ptsRaw = points[String(d.itemId)];
    const ptsArr = Array.isArray(ptsRaw) ? ptsRaw : Object.values((ptsRaw ?? {}) as Record<string, { t: number; c: number; q?: number }>);
    console.log(`-- [web-only] ${d.name}(${d.itemId}) src=${sig.source} vendor=${d.vendor} pluginPts=${ptsArr.length} webSamples=${sig.med7Samples} med7=${sig.med7} min=${sig.minPrice}`);
  }
  await prisma.$disconnect();
}

type PluginRadar = { minProfit: number; minProfitRatio: number; discount: number; minAuctions: number; minHistory: number; minMed7Distinct: number; maxDiscount: number; supplyShrink?: boolean; supplyShrinkMax?: number; supplyCap?: number };
type AddonEntry = { name: string; minPrice: number; marketPrice: number; quantity: number; numAuctions?: number; vendorP?: number };

main().catch((e) => { console.error(e); process.exit(1); });
