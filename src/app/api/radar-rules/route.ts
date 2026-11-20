// 雷达设置读写：GET 返回当前生效阈值（默认 + RadarRule 覆盖合并），
// POST 保存覆盖到 RadarRule 单行（id=1），page.tsx 读取后传给 buildDealRadar。
import { NextRequest, NextResponse } from "next/server";
import { mergeRadarRules, RADAR_RULES_VERSION } from "@/lib/market-rules";
import { getRadarRules } from "@/lib/repositories";
import { prisma } from "@/lib/prisma";
import { L } from "@/lib/i18n";
import { getLang } from "@/lib/i18n-server";

const DAY_MS = 24 * 60 * 60 * 1000;

// 接受字段：与 DealRadarRules 对应（金额单位：铜）；staleWindow 用天为单位（UI 友好）。
// 保存时打上 RADAR_RULES_VERSION：口径升级后旧版本的保存值整体作废（见 mergeRadarRules）。
const NUMERIC_FIELDS = ["vendorMinTotalProfit", "flipMinUnitProfit", "flipMinUnitRatio", "flipMinTotalProfit", "minHistory", "minMed7Distinct"] as const;

export async function GET() {
  const rules = mergeRadarRules(await getRadarRules());
  return NextResponse.json({
    ...rules,
    staleWindowDays: rules.staleWindowMs / DAY_MS
  });
}

export async function POST(request: NextRequest) {
  const lang = await getLang();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: L(lang, "Request body is not valid JSON", "请求体不是合法 JSON") }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: L(lang, "Request body must be an object", "请求体必须是对象") }, { status: 400 });
  }
  const source = body as Record<string, unknown>;
  // 以当前生效值为底（而非默认值），只提交部分字段时不会把其他已保存的值冲掉。
  const merged: Record<string, number> = { ...mergeRadarRules(await getRadarRules()), version: RADAR_RULES_VERSION };
  for (const field of NUMERIC_FIELDS) {
    const value = source[field];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) merged[field] = value;
    else if (value !== undefined) return NextResponse.json({ error: L(lang, `Field ${field} must be a number ≥ 0`, `字段 ${field} 必须是 ≥0 的数字`) }, { status: 400 });
  }
  if (source.staleWindowDays !== undefined) {
    const days = source.staleWindowDays;
    if (typeof days !== "number" || !Number.isFinite(days) || days < 0) {
      return NextResponse.json({ error: L(lang, "Field staleWindowDays must be a number ≥ 0 (days)", "字段 staleWindowDays 必须是 ≥0 的数字（天）") }, { status: 400 });
    }
    merged.staleWindowMs = Math.round(days * DAY_MS);
  }
  await prisma.radarRule.upsert({
    where: { id: 1 },
    create: { id: 1, rules: merged },
    update: { rules: merged }
  });
  return NextResponse.json({ ...merged, staleWindowDays: merged.staleWindowMs / DAY_MS });
}
