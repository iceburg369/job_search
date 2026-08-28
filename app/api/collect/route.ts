import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store, max-age=0" };

// 동시 실행 방지 (개발 서버 단일 프로세스 기준)
let running = false;

function runCollect(): Promise<{ ok: boolean; source?: string; jobCount?: number; message?: string; log: string }> {
  return new Promise((resolve, reject) => {
    const script = path.join(process.cwd(), "scripts", "collect.mjs");
    const child = spawn(process.execPath, [script], {
      cwd: process.cwd(),
      env: { ...process.env, COLLECT_TRIGGER: "api" }
    });

    let out = "";
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (out += d.toString()));
    child.on("error", reject);

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("취합 타임아웃 (90초)"));
    }, 90_000);

    child.on("close", (code) => {
      clearTimeout(timer);
      const line = out.split("\n").find((l) => l.startsWith("__RESULT__ "));
      let parsed: Record<string, unknown> = {};
      if (line) {
        try {
          parsed = JSON.parse(line.slice("__RESULT__ ".length));
        } catch {
          /* ignore */
        }
      }
      if (code === 0 && parsed.ok !== false) {
        resolve({
          ok: true,
          source: parsed.source as string | undefined,
          jobCount: parsed.jobCount as number | undefined,
          message: parsed.message as string | undefined,
          log: out.trim()
        });
      } else {
        reject(new Error((parsed.error as string) || `collect 실패 (exit ${code})\n${out.trim()}`));
      }
    });
  });
}

export async function POST() {
  if (running) {
    return NextResponse.json({ error: "이미 취합이 진행 중입니다." }, { status: 409, headers: NO_STORE });
  }
  running = true;
  try {
    const result = await runCollect();
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500, headers: NO_STORE });
  } finally {
    running = false;
  }
}
