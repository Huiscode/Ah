import { NextResponse } from "next/server";
import { getAppState, setAppState } from "@/lib/app-state";

const KEY = "ahledgerEnabled";

// GET /api/ahledger/toggle -> { enabled }
export async function GET() {
  const value = await getAppState(KEY);
  return NextResponse.json({ enabled: value !== "0" }); // default: on
}

// POST /api/ahledger/toggle  body { enabled: boolean }
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { enabled?: boolean } | null;
  if (body === null || typeof body.enabled !== "boolean") {
    return NextResponse.json({ error: "body.enabled (boolean) required" }, { status: 400 });
  }
  await setAppState(KEY, body.enabled ? "1" : "0");
  return NextResponse.json({ enabled: body.enabled });
}
