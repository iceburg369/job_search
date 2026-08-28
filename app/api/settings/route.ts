import { NextResponse } from "next/server";
import { mergeSettings, readSettings, writeSettings } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET() {
  try {
    const s = await readSettings();
    return NextResponse.json(s, { headers: NO_STORE });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON 본문이 아닙니다." }, { status: 400 });
  }

  // 부분 업데이트 허용: 저장된 설정 위에 body 를 얹어 병합
  const current = await readSettings();
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const merged = mergeSettings({
    criteria: b.criteria ?? current.criteria,
    dailyCollectAt: b.dailyCollectAt ?? current.dailyCollectAt,
    lastCollectedAt: b.lastCollectedAt ?? current.lastCollectedAt
  });

  try {
    const saved = await writeSettings(merged);
    return NextResponse.json(saved, { headers: NO_STORE });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
