const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const rows = await p.auctionSnapshot.findMany({
    where: { rawPayload: { not: null } },
    select: { itemId: true, rawPayload: true, timestamp: true },
    orderBy: { timestamp: 'desc' },
    take: 10
  });
  for (const r of rows) {
    const rp = r.rawPayload;
    if (rp && typeof rp === 'object' && rp.ladder) {
      console.log('itemId', r.itemId, 'time', r.timestamp.toISOString(), 'ladder rows:', rp.ladder.length);
      console.log('  first 3:', JSON.stringify(rp.ladder.slice(0,3)));
    } else {
      console.log('itemId', r.itemId, 'no ladder. keys:', rp ? Object.keys(rp) : 'null');
    }
  }
  await p.$disconnect();
})();
