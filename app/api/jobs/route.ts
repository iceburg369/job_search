import { NextResponse } from "next/server";
import { readRankedJobs } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const file = await readRankedJobs();
    return NextResponse.json(file, {
      headers: { "Cache-Control": "no-store, max-age=0" }
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message ?? "ranked-jobs.json 을 읽을 수 없습니다." },
      { status: 500 }
    );
  }
}
