// 雷达设置读写：GET 返回当前生效阈值（默认 + RadarRule 覆盖合并），
// POST 保存覆盖到 RadarRule 单行（id=1），page.tsx 读取后传给 buildDealRadar。
import { NextRequest, NextResponse } from "next/server";
import { dealRadarRules, mergeRadarRules } from "@/lib/market-rules";
import { getRadarRules } from "@/lib/repositories";
import { prisma } from "@/lib/prisma";

const DAY_MS = 24 * 60 * 60 * 1000;

// 接受字段：与 DealRadarRules 对应；staleWindow 用天为单位（UI 友好）。
// 2026-10-14 用户拍板：discount（折扣线）、maxDiscount、supplyCap、
// minProfitRatio（最低利润率）已从规则移除。
const NUMERIC_FIELDS = ["minProfit", "minHistory", "minMed7Distinct"] as const;
const DAY_FIELDS = ["staleWindowDays"] as const;

export async function GET() {
  const rules = mergeRadarRules(await getRadarRules());
  return NextResponse.json({
    ...rules,
    staleWindowDays: rules.staleWindowMs / DAY_MS
  });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "请求体必须是对象" }, { status: 400 });
  }
  const source = body as Record<string, unknown>;
  const merged: Record<string, number> = { ...dealRadarRules };
  for (const field of NUMERIC_FIELDS) {
    const value = source[field];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) merged[field] = value;
    else if (value !== undefined) return NextResponse.json({ error: `字段 ${field} 必须是 ≥0 的数字` }, { status: 400 });
  }
  if (source.staleWindowDays !== undefined) {
    const days = source.staleWindowDays;
    if (typeof days !== "number" || !Number.isFinite(days) || days < 0) {
      return NextResponse.json({ error: "字段 staleWindowDays 必须是 ≥0 的数字（天）" }, { status: 400 });
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
