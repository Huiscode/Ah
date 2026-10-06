import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type PricePoint = { price: number; count: number };

export async function GET(_: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = await params;
  const id = Number(itemId);
  if (!id) return NextResponse.json({ error: "bad id" }, { status: 400 });

  const item = await prisma.item.findUnique({ where: { itemId: id }, select: { name: true, quality: true } });
  const snap = await prisma.auctionSnapshot.findFirst({
    where: { itemId: id, source: "addon", market: "faction", rawPayload: { not: undefined } },
    orderBy: { timestamp: "desc" },
    select: { rawPayload: true }
  });
  const rp = snap?.rawPayload as { ladder?: PricePoint[] } | undefined;
  return NextResponse.json({
    name: item?.name ?? `Item ${id}`,
    quality: item?.quality ?? "common",
    ladder: rp?.ladder ?? []
  });
}
