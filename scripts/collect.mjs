#!/usr/bin/env node
/**
 * 공고 취합 스크립트.
 *
 * 호출 경로
 *   - 앱의 "적용 · 사람인 재취합" 버튼 → POST /api/collect → 이 스크립트를 spawn
 *   - OS 스케줄러(Windows 작업 스케줄러 / cron)에 `npm run collect` 등록 (data/settings.json 의 dailyCollectAt 시각)
 *       Windows: schtasks /create /tn "job-collect" /tr "cmd /c cd /d D:\job && npm run collect" /sc daily /st 09:00
 *       cron:    0 9 * * *  cd /path/to/job && npm run collect
 *
 * 하는 일
 *   1) data/settings.json 에서 평가 기준(weights/thresholds/hardFilters)을 읽는다
 *   2) 사람인에서 새 공고를 가져온다 (아래 "fresh 소스" 참고). 없으면 기존 공고를 유지
 *   3) 모든 공고를 현재 기준으로 재채점한다 (id 유지 → 지원상태 연결 보존)
 *   4) data/ranked-jobs.json 갱신, data/settings.json 의 lastCollectedAt/lastCollectSource 기록
 *
 * fresh 소스 (2번) — 아래 순서로 시도, 먼저 성공하는 것을 사용:
 *   a) data/inbox/ranked-jobs.json  … MCP(playMCP 사람인)를 쓸 수 있는 에이전트/사람이 새 취합 결과를
 *      이 경로에 떨궈두면 여기서 흡수하고 data/inbox/processed-<ts>.json 으로 옮긴다.
 *   b) scripts/fetch-saramin.mjs 의 export `fetchJobs(criteria)` … 사람인 오픈 API/사내 크롤러 연결 지점.
 *   c) 둘 다 없으면 → 기존 ranked-jobs.json 을 그대로 두고 재채점만 (source: "rescore").
 */
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RANKED = path.join(ROOT, "data", "ranked-jobs.json");
const SETTINGS = path.join(ROOT, "data", "settings.json");
const INBOX = path.join(ROOT, "data", "inbox", "ranked-jobs.json");
const FETCHER = path.join(ROOT, "scripts", "fetch-saramin.mjs");

const AXIS_KEYS = ["daegu", "salary", "companyValue", "liberalArtsOk", "benefits", "majorAny", "publicJob"];
const DEFAULT_WEIGHTS = { daegu: 2, salary: 1, companyValue: 1, liberalArtsOk: 1, benefits: 1, majorAny: 2, publicJob: 1 };
const DEFAULT_THRESHOLDS = { A: 75, B: 60, C: 45 };

function scoreJob(b, w) {
  const wsum = AXIS_KEYS.reduce((s, k) => s + Math.max(0, w[k] || 0), 0);
  if (wsum <= 0) return 0;
  const raw = AXIS_KEYS.reduce((s, k) => s + (b[k] || 0) * Math.max(0, w[k] || 0), 0);
  return Math.round((raw / (wsum * 5)) * 100);
}
function gradeFor(s, t) {
  if (s >= t.A) return "A";
  if (s >= t.B) return "B";
  if (s >= t.C) return "C";
  return "D";
}

async function readJson(p, fallback) {
  try {
    return JSON.parse(await readFile(p, "utf-8"));
  } catch (e) {
    if (e.code === "ENOENT") return fallback;
    throw e;
  }
}

/** 새 공고 목록을 확보한다. 성공 시 { jobs, source }, 실패 시 null. */
async function getFreshJobs(criteria) {
  // a) inbox 파일
  const inbox = await readJson(INBOX, null);
  if (inbox) {
    const jobs = Array.isArray(inbox) ? inbox : inbox.jobs ?? [];
    if (jobs.length) {
      await mkdir(path.dirname(INBOX), { recursive: true });
      await rename(INBOX, path.join(ROOT, "data", "inbox", `processed-${Date.now()}.json`)).catch(() => {});
      return { jobs, source: "inbox" };
    }
  }
  // b) fetch-saramin.mjs
  try {
    const mod = await import(pathToFileURL(FETCHER).href);
    if (typeof mod.fetchJobs === "function") {
      const jobs = await mod.fetchJobs(criteria);
      if (Array.isArray(jobs) && jobs.length) return { jobs, source: "fetch-saramin" };
    }
  } catch (e) {
    if (e.code !== "ERR_MODULE_NOT_FOUND" && !String(e.message).includes("Cannot find module")) {
      console.warn("[collect] fetch-saramin.mjs 실행 경고:", e.message);
    }
  }
  return null;
}

/** 기존 공고의 지원상태 연결용 필드는 유지하면서 fresh 로 교체/병합. */
function mergeJobs(existing, fresh) {
  const byId = new Map(existing.map((j) => [j.id, j]));
  return fresh.map((nj) => {
    const old = byId.get(nj.id);
    return old ? { ...old, ...nj } : nj;
  });
}

async function main() {
  const settings = await readJson(SETTINGS, {});
  const criteria = settings?.criteria ?? {};
  const weights = criteria.weights ?? DEFAULT_WEIGHTS;
  const thresholds = criteria.thresholds ?? DEFAULT_THRESHOLDS;

  const file = await readJson(RANKED, { jobs: [] });
  const existing = Array.isArray(file) ? file : file.jobs ?? [];

  const fresh = await getFreshJobs(criteria);
  const jobs = fresh ? mergeJobs(existing, fresh.jobs) : existing;
  const source = fresh ? fresh.source : "rescore";

  const recomputed = jobs.map((j) => {
    const b = j.breakdown || {};
    const score = scoreJob(b, weights);
    const weighted = Math.round(AXIS_KEYS.reduce((s, k) => s + (b[k] || 0) * (weights[k] || 0), 0) * 100) / 100;
    return { ...j, score, weighted, grade: gradeFor(score, thresholds) };
  });

  const out = Array.isArray(file)
    ? recomputed
    : { ...file, generatedAt: new Date().toISOString().slice(0, 10), jobs: recomputed };
  await writeFile(RANKED, JSON.stringify(out, null, 2) + "\n", "utf-8");

  const nextSettings = {
    ...settings,
    lastCollectedAt: new Date().toISOString(),
    lastCollectSource: source
  };
  await writeFile(SETTINGS, JSON.stringify(nextSettings, null, 2) + "\n", "utf-8");

  const msg =
    source === "rescore"
      ? `${recomputed.length}개 공고 재채점 (새 사람인 데이터 없음 — inbox/fetch-saramin 미연결)`
      : `${recomputed.length}개 공고 취합 (source: ${source})`;
  console.log(`[collect] ${msg} · 기준 ${JSON.stringify(weights)} · ${new Date().toLocaleString("ko-KR")}`);
  // JSON 한 줄 — API 가 파싱
  console.log(`__RESULT__ ${JSON.stringify({ ok: true, source, jobCount: recomputed.length, message: msg })}`);
}

main().catch((e) => {
  console.error("[collect] 실패:", e);
  console.log(`__RESULT__ ${JSON.stringify({ ok: false, error: String(e.message || e) })}`);
  process.exit(1);
});
