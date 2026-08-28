import { NextResponse } from "next/server";
import { readStatusMap, writeStatusMap } from "@/lib/data";
import { APPLY_STATUSES, type ApplyStatus, type StatusMap } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isStatus(v: unknown): v is ApplyStatus {
  return typeof v === "string" && (APPLY_STATUSES as readonly string[]).includes(v);
}

export async function GET() {
  try {
    const map = await readStatusMap();
    return NextResponse.json(map, {
      headers: { "Cache-Control": "no-store, max-age=0" }
    });
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

  const current = await readStatusMap();
  let next: StatusMap = { ...current };

  const b = body as Record<string, unknown>;

  if (b && typeof b.id === "string" && "status" in b) {
    // 단건 변경: { id, status }  — status 가 null/"" 이면 삭제(미지원)
    if (b.status === null || b.status === "" || b.status === "미지원") {
      delete next[b.id];
    } else if (isStatus(b.status)) {
      next[b.id] = b.status;
    } else {
      return NextResponse.json({ error: `알 수 없는 상태: ${String(b.status)}` }, { status: 400 });
    }
  } else if (b && typeof b.map === "object" && b.map) {
    // 전체 동기화: { map: { id: status } }
    const incoming = b.map as Record<string, unknown>;
    const clean: StatusMap = {};
    for (const [id, s] of Object.entries(incoming)) {
      if (isStatus(s) && s !== "미지원") clean[id] = s;
    }
    next = clean;
  } else {
    return NextResponse.json(
      { error: "본문은 { id, status } 또는 { map } 형식이어야 합니다." },
      { status: 400 }
    );
  }

  try {
    await writeStatusMap(next);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }

  return NextResponse.json(next, {
    headers: { "Cache-Control": "no-store, max-age=0" }
  });
}
