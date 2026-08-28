import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { Redis } from "@upstash/redis";
import { DEFAULT_SETTINGS, type AppSettings, type DeepDive, type RankedJobsFile, type StatusMap } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const RANKED_PATH = path.join(DATA_DIR, "ranked-jobs.json");
const DEEP_DIR = path.join(DATA_DIR, "deep-dives");

/* ---------- 저장소 (Vercel 등 읽기전용 FS 대응) ----------
 * 우선순위:
 *   1. Vercel KV / Upstash Redis  — 환경변수가 있으면 영구 저장소로 사용 (기기·재배포 간 유지)
 *   2. data/ (로컬 파일)          — 로컬 개발·자체 호스팅
 *   3. os.tmpdir()               — Vercel Lambda 에서 유일하게 쓸 수 있는 곳 (인스턴스 수명 동안만)
 *   4. 프로세스 메모리            — 마지막 방어선
 * 쓰기는 어느 단계든 성공하면 throw 하지 않는다. 읽기는 KV → 메모리 → tmp → 번들된 data/ 순.
 *
 * KV 를 켜려면 Vercel 대시보드에서 Storage → Redis(Upstash) 를 만들고 프로젝트에 연결하면
 * KV_REST_API_URL / KV_REST_API_TOKEN (또는 UPSTASH_REDIS_REST_URL/TOKEN) 이 자동 주입된다. */
const TMP_DIR = path.join(os.tmpdir(), "job-status-board");

const KV_URL = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const kv = KV_URL && KV_TOKEN ? new Redis({ url: KV_URL, token: KV_TOKEN }) : null;
export const kvEnabled = kv !== null;
const kvKey = (name: string) => "jobboard:" + name.replace(/\.json$/i, "");

/** 인스턴스 수명 동안 마지막으로 저장한 값 (파일 저장이 모두 막혀도 최소한 유지). */
const memoryStore = new Map<string, string>();

function isReadOnlyFsError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === "EROFS" || code === "EACCES" || code === "EPERM" || code === "ENOENT";
}

export type PersistTarget = "kv" | "fs" | "tmp" | "memory";

/** <name> 을 저장한다: KV(있으면) → data/ → os.tmpdir() → 메모리. 절대 throw 하지 않는다. */
async function persistJson(name: string, text: string): Promise<PersistTarget> {
  memoryStore.set(name, text);
  if (kv) {
    try {
      await kv.set(kvKey(name), JSON.parse(text));
      return "kv";
    } catch (err) {
      console.error("[data] KV 저장 실패, 파일로 폴백:", (err as Error).message);
    }
  }
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(path.join(DATA_DIR, name), text, "utf-8");
    return "fs";
  } catch (err) {
    if (!isReadOnlyFsError(err)) throw err;
  }
  try {
    await fs.mkdir(TMP_DIR, { recursive: true });
    await fs.writeFile(path.join(TMP_DIR, name), text, "utf-8");
    return "tmp";
  } catch {
    return "memory";
  }
}

/** <name> 을 읽는다: KV(있으면) → 메모리 캐시 → tmp 사본 → 번들된 data/ 원본. 없으면 null. */
async function loadJson(name: string): Promise<string | null> {
  if (kv) {
    try {
      const v = await kv.get(kvKey(name));
      if (v != null) {
        const s = typeof v === "string" ? v : JSON.stringify(v);
        memoryStore.set(name, s);
        return s;
      }
    } catch (err) {
      console.error("[data] KV 읽기 실패, 파일로 폴백:", (err as Error).message);
    }
  }
  const mem = memoryStore.get(name);
  if (mem !== undefined) return mem;
  for (const p of [path.join(TMP_DIR, name), path.join(DATA_DIR, name)]) {
    try {
      const raw = await fs.readFile(p, "utf-8");
      memoryStore.set(name, raw);
      return raw;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  return null;
}

/** data/ranked-jobs.json 을 매 요청마다 새로 읽는다 (파일 갱신 → 새로고침 반영).
 * 읽기전용 FS(Vercel)에서는 collect 가 tmp 에 갱신본을 쓰므로 tmp 를 먼저 본다.
 * 메모리 캐시는 쓰지 않는다 — 재취합 직후 새로고침에 즉시 반영되도록. */
export async function readRankedJobs(): Promise<RankedJobsFile> {
  let raw: string | null = null;
  for (const p of [path.join(TMP_DIR, "ranked-jobs.json"), RANKED_PATH]) {
    try {
      raw = await fs.readFile(p, "utf-8");
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
  if (raw == null) throw new Error("ranked-jobs.json 을 읽을 수 없습니다.");
  const parsed = JSON.parse(raw);
  const jobs = Array.isArray(parsed) ? parsed : parsed.jobs;
  if (!Array.isArray(jobs)) {
    throw new Error("ranked-jobs.json 형식 오류: jobs 배열이 없습니다.");
  }
  return { ...(Array.isArray(parsed) ? {} : parsed), jobs };
}

export async function readStatusMap(): Promise<StatusMap> {
  const raw = await loadJson("status.json");
  if (raw == null) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as StatusMap) : {};
  } catch {
    return {};
  }
}

export async function writeStatusMap(map: StatusMap): Promise<PersistTarget> {
  return persistJson("status.json", JSON.stringify(map, null, 2) + "\n");
}

/* ---------- 설정 (평가 기준 + 일일 취합 시간) ---------- */

function clampNum(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 저장된 설정 + 기본값 병합 (부분 저장/누락 필드 방어). */
export function mergeSettings(raw: unknown): AppSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rw = (s.criteria && typeof s.criteria === "object" ? s.criteria : {}) as Record<string, unknown>;
  const w = (rw.weights && typeof rw.weights === "object" ? rw.weights : {}) as Record<string, unknown>;
  const t = (rw.thresholds && typeof rw.thresholds === "object" ? rw.thresholds : {}) as Record<string, unknown>;
  const hf = (rw.hardFilters && typeof rw.hardFilters === "object" ? rw.hardFilters : {}) as Record<string, unknown>;
  const d = DEFAULT_SETTINGS;
  const dw = d.criteria.weights;
  const dhf = d.criteria.hardFilters;
  const bool = (v: unknown, fb: boolean) => (typeof v === "boolean" ? v : fb);
  return {
    criteria: {
      weights: {
        daegu: clampNum(w.daegu, 0, 10, dw.daegu),
        salary: clampNum(w.salary, 0, 10, dw.salary),
        companyValue: clampNum(w.companyValue, 0, 10, dw.companyValue),
        liberalArtsOk: clampNum(w.liberalArtsOk, 0, 10, dw.liberalArtsOk),
        benefits: clampNum(w.benefits, 0, 10, dw.benefits),
        majorAny: clampNum(w.majorAny, 0, 10, dw.majorAny),
        publicJob: clampNum(w.publicJob, 0, 10, dw.publicJob)
      },
      thresholds: {
        A: clampNum(t.A, 0, 100, d.criteria.thresholds.A),
        B: clampNum(t.B, 0, 100, d.criteria.thresholds.B),
        C: clampNum(t.C, 0, 100, d.criteria.thresholds.C)
      },
      hardFilters: {
        noWrittenTest: bool(hf.noWrittenTest, dhf.noWrittenTest),
        regularOnly: bool(hf.regularOnly, dhf.regularOnly),
        newOrAny: bool(hf.newOrAny, dhf.newOrAny),
        excludeSciTechPro: bool(hf.excludeSciTechPro, dhf.excludeSciTechPro)
      }
    },
    dailyCollectAt: typeof s.dailyCollectAt === "string" && TIME_RE.test(s.dailyCollectAt)
      ? s.dailyCollectAt
      : d.dailyCollectAt,
    lastCollectedAt:
      typeof s.lastCollectedAt === "string" && s.lastCollectedAt ? s.lastCollectedAt : null,
    lastCollectSource:
      typeof s.lastCollectSource === "string" && s.lastCollectSource ? s.lastCollectSource : null
  };
}

export async function readSettings(): Promise<AppSettings> {
  const raw = await loadJson("settings.json");
  if (raw == null) return DEFAULT_SETTINGS;
  try {
    return mergeSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function writeSettings(next: AppSettings): Promise<AppSettings> {
  const clean = mergeSettings(next);
  await persistJson("settings.json", JSON.stringify(clean, null, 2) + "\n");
  return clean;
}

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** data/deep-dives/*.json 중 존재하는 리포트의 id 목록. */
export async function listDeepDiveIds(): Promise<string[]> {
  try {
    const files = await fs.readdir(DEEP_DIR);
    return files
      .filter((f) => f.toLowerCase().endsWith(".json"))
      .map((f) => f.replace(/\.json$/i, ""));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

/** 특정 공고의 심층조사 리포트. 없으면 null. */
export async function readDeepDive(id: string): Promise<DeepDive | null> {
  if (!SAFE_ID.test(id)) return null;
  try {
    const raw = await fs.readFile(path.join(DEEP_DIR, `${id}.json`), "utf-8");
    return JSON.parse(raw) as DeepDive;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
