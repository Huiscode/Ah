import { NextResponse } from "next/server";
import { normalizeAddonScan, normalizeAddonPoints, normalizeAddonRecipes } from "@/lib/addon-scan";
import { importSnapshot, ImportConflictError, type ImportScanItem } from "@/lib/import-common";

export async function POST(request: Request) {
  let rawBody: Record<string, unknown> | null = null;
  try {
    rawBody = (await request.json()) as Record<string, unknown>;
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  let scan;
  try {
    scan = normalizeAddonScan(rawBody);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
  }

  const points = normalizeAddonPoints(rawBody?.points);
  // P0-B recipe dumps are auxiliary: a malformed recipes payload must never
  // reject a good scan, so normalization failure -> undefined (recipes
  // simply do not ride along this round).
  const recipes = (() => {
    try {
      return normalizeAddonRecipes(rawBody?.recipes);
    } catch {
      return undefined;
    }
  })();
  try {
    const result = await importSnapshot({
      source: "addon",
      scannedAt: scan.scannedAt,
      server: scan.server,
      faction: scan.faction,
      items: scan.items as unknown as ImportScanItem[],
      ...(points !== undefined ? { points } : {}),
      ...(typeof rawBody?.after === "number" && rawBody.after > 0 ? { after: rawBody.after } : {}),
      ...(scan.rules !== undefined ? { rules: scan.rules } : {}),
      ...(recipes !== undefined ? { recipes } : {})
    });
    return NextResponse.json({ imported: result.imported, points: result.points, recipes: recipes?.length ?? 0, scannedAt: result.scannedAt });
  } catch (error) {
    if (error instanceof ImportConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
