import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { DEFAULT_SETTINGS, type AppSettings, type DeepDive, type RankedJobsFile, type StatusMap } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const RANKED_PATH = path.join(DATA_DIR, "ranked-jobs.json");
const DEEP_DIR = path.join(DATA_DIR, "deep-dives");

/* ---------- 쓰기 가능한 저장소 (Vercel 등 읽기전용 FS 대응) ----------
 * Vercel 서버리스는 /var/task 가 읽기전용이라 data/*.json 저장이 EROFS 로 실패한다.
 * 그래서 저장은 다음 순서로 자동 강등한다: data/  →  os.tmpdir()  →  프로세스 메모리.
 * 어느 단계든 성공하면 에러를 던지지 않는다. (읽기는 메모리 → tmp → 번들된 data/ 순)
 * 영구 보관이 필요하면 Vercel KV/Postgres/Blob 같은 외부 저장소를 붙이면 된다. */
const TMP_DIR = path.join(os.tmpdir(), "job-status-board");

/** 인스턴스 수명 동안 마지막으로 저장한 값 (파일 저장이 모두 막혀도 최소한 유지). */
const memoryStore = new Map<string, string>();

function isReadOnlyFsError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === "EROFS" || code === "EACCES" || code === "EPERM" || code === "ENOENT";
}

export type PersistTarget = "fs" | "tmp" | "memory";

/** data/<name> 에 저장을 시도하고, 읽기전용이면 tmp → 메모리로 강등한다. 절대 throw 하지 않는다. */
async function persistJson(name: string, text: string): Promise<PersistTarget> {
  memoryStore.set(name, text);
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

/** data/<name> 를 읽는다: 메모리 캐시 → tmp 사본 → 저장소에 번들된 원본 순. 없으면 null. */
async function loadJson(name: string): Promise<string | null> {
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
