// 双服务器分服验证（2026-10-18）：确认导入端 server 打标正确、查询端按
// server 过滤有效。可重复跑；中国服尚未配置时 cn 侧应为空。
import { prisma } from "@/lib/prisma";
import { getMarketUniverse, getLatestSnapshotTime } from "@/lib/repositories";
import { getMarketSignals as signalsCached } from "@/lib/market-signals";

process.loadEnvFile();

async function main() {
  const snapServers = await prisma.$queryRaw<Array<{ server: string; n: number }>>`
    SELECT "server", COUNT(*) AS "n" FROM "AuctionSnapshot" GROUP BY "server"`;
  const dailyServers = await prisma.$queryRaw<Array<{ server: string; n: number }>>`
    SELECT "server", COUNT(*) AS "n" FROM "DailySummary" GROUP BY "server"`;
  const tierServers = await prisma.$queryRaw<Array<{ server: string; n: number }>>`
    SELECT "server", COUNT(*) AS "n" FROM "AuctionTier" GROUP BY "server"`;
  console.log("AuctionSnapshot 按 server 分布：", snapServers.map((r) => `${r.server}(${Number(r.n)})`).join(", "));
  console.log("DailySummary 按 server 分布：", dailyServers.map((r) => `${r.server}(${Number(r.n)})`).join(", "));
  console.log("AuctionTier 按 server 分布：", tierServers.map((r) => `${r.server}(${Number(r.n)})`).join(", "));

  // 查询层验证：eu 有数据、cn 应无数据（尚未配置中国服）。
  for (const server of ["eu", "cn"]) {
    const t = await getLatestSnapshotTime("faction", "current", server);
    const universe = await getMarketUniverse("faction", "current", server);
    const nonEmpty = universe.filter((i) => i.snapshots.length > 0).length;
    const { signals } = await signalsCached("faction", "current", server);
    console.log(`[${server}] 最新快照=${t?.toISOString() ?? "无"} | universe 非空物品=${nonEmpty} | signals=${signals.length}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
