import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { setAppState } from "@/lib/app-state";

// Clear the trading ledger (web-side "一键清空账本").
//
// The SavedVariables watcher re-uploads the whole ledger on every game flush
// (POST /api/import/ledger, upsert by uid), so wiping the table alone would
// be undone on the next tick. We therefore stamp a ledgerClearedAt marker
// (unix seconds) FIRST — the import route skips any record older than it —
// then delete the rows. Records stamped before the marker are permanently
// excluded from re-import; new fills (ts > clearedAt) keep flowing in.
//
// Tiny race: an upload already in flight when this runs may have read the
// marker before it was set and re-insert a few old rows after the delete.
// The window is milliseconds and needs a game SV flush at the same instant;
// a second clear would fix it. Accepted for a local single-operator tool.
export async function POST() {
  const clearedAt = Math.floor(Date.now() / 1000);
  await setAppState("ledgerClearedAt", String(clearedAt));
  const { count } = await prisma.tradeRecord.deleteMany({});
  return NextResponse.json({ cleared: count, clearedAt });
}
