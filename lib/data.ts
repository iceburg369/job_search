import { promises as fs } from "fs";
import path from "path";
import { DEFAULT_SETTINGS, type AppSettings, type DeepDive, type RankedJobsFile, type StatusMap } from "./types";

const DATA_DIR = path.join(process.cwd(), "data");
const RANKED_PATH = path.join(DATA_DIR, "ranked-jobs.json");
const STATUS_PATH = path.join(DATA_DIR, "status.json");
const SETTINGS_PATH = path.join(DATA_DIR, "settings.json");
const DEEP_DIR = path.join(DATA_DIR, "deep-dives");

/** data/ranked-jobs.json 을 매 요청마다 새로 읽는다 (파일 갱신 → 새로고침 반영). */
export async function readRankedJobs(): Promise<RankedJobsFile> {
  const raw = await fs.readFile(RANKED_PATH, "utf-8");
  const parsed = JSON.parse(raw);
  const jobs = Array.isArray(parsed) ? parsed : parsed.jobs;
  if (!Array.isArray(jobs)) {
    throw new Error("ranked-jobs.json 형식 오류: jobs 배열이 없습니다.");
  }
  return { ...(Array.isArray(parsed) ? {} : parsed), jobs };
}

export async function readStatusMap(): Promise<StatusMap> {
  try {
    const raw = await fs.readFile(STATUS_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as StatusMap) : {};
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}

export async function writeStatusMap(map: StatusMap): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STATUS_PATH, JSON.stringify(map, null, 2) + "\n", "utf-8");
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
  try {
    const raw = await fs.readFile(SETTINGS_PATH, "utf-8");
    return mergeSettings(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return DEFAULT_SETTINGS;
    throw err;
  }
}

export async function writeSettings(next: AppSettings): Promise<AppSettings> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const clean = mergeSettings(next);
  await fs.writeFile(SETTINGS_PATH, JSON.stringify(clean, null, 2) + "\n", "utf-8");
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
