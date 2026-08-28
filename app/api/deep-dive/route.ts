import { NextResponse } from "next/server";
import { listDeepDiveIds, readDeepDive } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");

  // id 없음 → 리포트가 존재하는 공고 id 목록
  if (!id) {
    try {
      const ids = await listDeepDiveIds();
      return NextResponse.json({ ids }, { headers: NO_STORE });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  // id 있음 → 해당 리포트
  try {
    const report = await readDeepDive(id);
    if (!report) {
      return NextResponse.json(
        { error: "이 공고의 심층조사 리포트가 아직 없습니다.", id },
        { status: 404, headers: NO_STORE }
      );
    }
    return NextResponse.json(report, { headers: NO_STORE });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
