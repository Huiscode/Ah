import { NextResponse } from "next/server";
import { normalizeRadarRules } from "@/lib/addon-scan";
import { prisma } from "@/lib/prisma";

// Lightweight rules-only sync: the in-game options panel writes settings.radar
// to SavedVariables on every keystroke/checkbox, often between scans. The
// watcher posts those changes here so the web radar thresholds stay in sync
// without waiting for the next full /wahscan.
export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }
  const rules = normalizeRadarRules(raw);
  if (!rules) {
    return NextResponse.json({ error: "no recognized radar rule fields" }, { status: 400 });
  }
  await prisma.radarRule.upsert({
    where: { id: 1 },
    update: { rules: rules as object },
    create: { id: 1, rules: rules as object }
  });
  return NextResponse.json({ ok: true, rules });
}
