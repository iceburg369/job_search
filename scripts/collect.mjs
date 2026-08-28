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
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RANKED = path.join(ROOT, "data", "ranked-jobs.json");
const SETTINGS = path.join(ROOT, "data", "settings.json");
const INBOX = path.join(ROOT, "data", "inbox", "ranked-jobs.json");
const FETCHER = path.join(ROOT, "scripts", "fetch-saramin.mjs");
/** 이번 취합에서 "새로 올라온" 공고만 추린 결과 — 카카오톡 알림 등이 읽어감. */
const NEW_JOBS = path.join(ROOT, "data", "new-jobs.json");

/** 읽기전용 FS(Vercel /var/task)면 os.tmpdir() 로 강등해서 쓴다. lib/data.ts 와 같은 경로. */
const TMP_DIR = path.join(os.tmpdir(), "job-status-board");
const RO_CODES = new Set(["EROFS", "EACCES", "EPERM", "ENOENT"]);
async function writeResilient(absPath, text) {
  try {
    await writeFile(absPath, text, "utf-8");
    return absPath;
  } catch (e) {
    if (!RO_CODES.has(e.code)) throw e;
    await mkdir(TMP_DIR, { recursive: true });
    const alt = path.join(TMP_DIR, path.basename(absPath));
    await writeFile(alt, text, "utf-8");
    return alt;
  }
}

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
      // 처리 완료 표시 (읽기전용 FS 면 실패해도 무시 — 취합 자체는 진행)
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

/** 기존 + fresh 를 id 기준 합집합으로 병합.
 *  - 겹치는 공고: 기존 값 위에 fresh 를 덮어씀 (지원상태 등 기존 필드 보존, 최신 정보 반영)
 *  - fresh 에만 있는 공고: 신규로 추가
 *  - 기존에만 있는 공고: 그대로 유지 (마감/삭제돼도 지원상태·이력 보존)
 *  정렬은 fresh(이번 취합분) 먼저, 그 뒤에 남은 기존 공고. */
function mergeJobs(existing, fresh) {
  const freshIds = new Set(fresh.map((j) => String(j.id)));
  const byId = new Map(existing.map((j) => [String(j.id), j]));
  const merged = fresh.map((nj) => {
    const old = byId.get(String(nj.id));
    return old ? { ...old, ...nj } : nj;
  });
  for (const oj of existing) {
    if (!freshIds.has(String(oj.id))) merged.push(oj);
  }
  return merged;
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

  // "오늘 신규" 판정용 firstSeenAt 채우기:
  //  - 이번에 새로 들어온 공고(기존 id 목록에 없음) → 지금 시각
  //  - 이미 있던 공고인데 값이 없음 → 직전 generatedAt(없으면 epoch) 으로 backfill (오늘 아님)
  const existingIds = new Set(existing.map((j) => String(j.id)));
  const nowIso = new Date().toISOString();
  const prevGen = !Array.isArray(file) && file.generatedAt ? new Date(file.generatedAt) : null;
  const backfillIso = prevGen && !Number.isNaN(prevGen.getTime()) ? prevGen.toISOString() : new Date(0).toISOString();

  const isNewThisRun = (j) => !existingIds.has(String(j.id));

  const recomputed = jobs.map((j) => {
    const b = j.breakdown || {};
    const score = scoreJob(b, weights);
    const weighted = Math.round(AXIS_KEYS.reduce((s, k) => s + (b[k] || 0) * (weights[k] || 0), 0) * 100) / 100;
    const firstSeenAt = j.firstSeenAt ?? (isNewThisRun(j) ? nowIso : backfillIso);
    return { ...j, score, weighted, grade: gradeFor(score, thresholds), firstSeenAt };
  });

  const out = Array.isArray(file)
    ? recomputed
    : { ...file, generatedAt: new Date().toISOString().slice(0, 10), jobs: recomputed };
  const rankedWrittenTo = await writeResilient(RANKED, JSON.stringify(out, null, 2) + "\n");

  // 이번 취합에서 새로 올라온 공고 (점수순) → data/new-jobs.json
  const newJobs = recomputed
    .filter(isNewThisRun)
    .sort((a, b) => b.score - a.score)
    .map((j) => ({
      id: j.id,
      company: j.company,
      role: j.role,
      grade: j.grade,
      score: j.score,
      location: j.location,
      deadline: j.deadline,
      url: j.url,
      firstSeenAt: j.firstSeenAt
    }));
  await writeResilient(
    NEW_JOBS,
    JSON.stringify({ generatedAt: nowIso, source, count: newJobs.length, jobs: newJobs }, null, 2) + "\n"
  );

  const nextSettings = {
    ...settings,
    lastCollectedAt: new Date().toISOString(),
    lastCollectSource: source
  };
  await writeResilient(SETTINGS, JSON.stringify(nextSettings, null, 2) + "\n");

  const roFallback = rankedWrittenTo !== RANKED;
  const msg =
    (source === "rescore"
      ? `${recomputed.length}개 공고 재채점 (새 사람인 데이터 없음 — inbox/fetch-saramin 미연결)`
      : `${recomputed.length}개 공고 취합 (source: ${source}) · 신규 ${newJobs.length}`) +
    (roFallback ? " · 읽기전용 FS → 임시 저장(tmp)" : "");
  console.log(`[collect] ${msg} · 기준 ${JSON.stringify(weights)} · ${new Date().toLocaleString("ko-KR")}`);
  // JSON 한 줄 — API 가 파싱
  console.log(
    `__RESULT__ ${JSON.stringify({ ok: true, source, jobCount: recomputed.length, newCount: newJobs.length, storage: roFallback ? "tmp" : "fs", message: msg })}`
  );
}

main().catch((e) => {
  console.error("[collect] 실패:", e);
  console.log(`__RESULT__ ${JSON.stringify({ ok: false, error: String(e.message || e) })}`);
  process.exit(1);
});
