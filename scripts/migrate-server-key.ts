// 一次性迁移：双服务器改造（2026-10-18）。
// 旧单服数据里 AuctionSnapshot/AuctionTier 的 server 列存的是显示名
// （"Classic Beta PvP 2"）；双服改造后 server 列统一存短标识（eu/cn），
// 网页查询与导入打标都以此为准。DailySummary 加列时默认 'eu'，无需处理。
// 幂等：目标值已是 'eu' 的行 UPDATE 影响 0 行，可重复跑。
import { prisma } from "@/lib/prisma";

process.loadEnvFile();

const LEGACY_SERVER_NAMES = ["Classic Beta PvP 2"];

async function main() {
  for (const name of LEGACY_SERVER_NAMES) {
    const snaps = await prisma.$executeRaw`UPDATE "AuctionSnapshot" SET "server" = 'eu' WHERE "server" = ${name}`;
    const tiers = await prisma.$executeRaw`UPDATE "AuctionTier" SET "server" = 'eu' WHERE "server" = ${name}`;
    const other = await prisma.$queryRaw<Array<{ server: string; n: number }>>`
      SELECT "server", COUNT(*) AS "n" FROM "AuctionSnapshot" GROUP BY "server"`;
    const dailyServers = await prisma.$queryRaw<Array<{ server: string; n: number }>>`
      SELECT "server", COUNT(*) AS "n" FROM "DailySummary" GROUP BY "server"`;
    console.log(`旧服务器名 "${name}" → 'eu'：快照 ${snaps} 行，档位 ${tiers} 行`);
    console.log("AuctionSnapshot 现存 server 分布：", other.map((r) => `${r.server}(${Number(r.n)})`).join(", "));
    console.log("DailySummary 现存 server 分布：", dailyServers.map((r) => `${r.server}(${Number(r.n)})`).join(", "));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
