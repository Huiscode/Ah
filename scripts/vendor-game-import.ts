// M4.1：游戏内商人价（WAHVendorDB）导入。
//
// 数据流：游戏内打开商人窗口 → VendorPrice.lua 实时读取 NPC 收购价
//   （C_Item.GetItemInfo 第 11 返回 sellPrice）→ 落盘 WAHVendorDB
//   （与 WAHTranscribeDB 同一个 SV 文件）→ 本脚本解析后 UPDATE
//   Item.vendorPrice（游戏内实时值优先，覆盖网站核对/旧缓存）。
//
// 权威顺序（用户 2026-10-14 拍板）：游戏内实时商人价 > foreverchanges 网站核对
//   > Auctionator 旧缓存（已弃用）。游戏内值由服务器直接下发，永远最准。
//
// 幂等性：同值不写、不重复打印；可反复运行。
//
// 跑法：npx tsx scripts/vendor-game-import.ts
import { prisma } from "@/lib/prisma";
import { loadVendorGamePrices, transcriptSvPath } from "@/lib/vendor-sv";

process.loadEnvFile();

async function main() {
  const prices = loadVendorGamePrices();
  if (!prices) {
    console.error(`存档里没有 WAHVendorDB.scans（${transcriptSvPath()}）——请先在游戏内打开商人窗口（插件自动记录 NPC 收购价）并 /reload 或登出落盘。`);
    process.exit(1);
  }

  const itemIds = Array.from(prices.keys());
  const existing = await prisma.item.findMany({
    where: { itemId: { in: itemIds } },
    select: { itemId: true, vendorPrice: true, sellPrice: true }
  });
  const existingMap = new Map(existing.map((row) => [row.itemId, { vendorPrice: row.vendorPrice, sellPrice: row.sellPrice }]));

  const updated: Array<{ itemId: number; field: string; old: number; next: number }> = [];
  const skipped: number[] = [];
  for (const [itemId, v] of prices) {
    const old = existingMap.get(itemId);
    if (old === undefined) {
      skipped.push(itemId); // 不在 Item 表（未收录物品），跳过
      continue;
    }
    if (old.vendorPrice !== v.p || (v.sp > 0 && old.sellPrice !== v.sp)) {
      await prisma.item.update({
        where: { itemId },
        data: { vendorPrice: v.p, ...(v.sp > 0 ? { sellPrice: v.sp } : {}) }
      });
      if (old.vendorPrice !== v.p) updated.push({ itemId, field: "vendorPrice", old: old.vendorPrice, next: v.p });
      if (v.sp > 0 && old.sellPrice !== v.sp) updated.push({ itemId, field: "sellPrice", old: old.sellPrice, next: v.sp });
    }
  }

  for (const row of updated) {
    console.log(`  ${row.itemId} ${row.field}: ${row.old} → ${row.next}`);
  }
  const sample = Array.from(prices.entries()).slice(0, 5).map(([id, v]) => `${id}(收${v.p}/卖${v.sp})`);
  console.log(`✅ 商人价导入完成：记录 ${prices.size} 条，更新 ${updated.length} 处，未收录跳过 ${skipped.length} 条。`);
  console.log(`   （最新值示例：${sample.join(", ")}${prices.size > 5 ? ", …" : ""}）`);
}

main().catch((e) => { console.error(e); process.exit(1); });
