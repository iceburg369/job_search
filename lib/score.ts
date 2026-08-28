import { AXES, type Criteria, type Grade, type Job } from "./types";

const AXIS_KEYS = AXES.map((a) => a.key);

/** breakdown(0~5) + 가중치 → 0~100 점수. 가중치 합으로 정규화하므로 비율만 의미 있음. */
export function scoreJob(breakdown: Job["breakdown"], weights: Criteria["weights"]): number {
  const wsum = AXIS_KEYS.reduce((s, k) => s + Math.max(0, weights[k] || 0), 0);
  if (wsum <= 0) return 0;
  const raw = AXIS_KEYS.reduce((s, k) => s + (breakdown[k] || 0) * Math.max(0, weights[k] || 0), 0);
  return Math.round((raw / (wsum * 5)) * 100);
}

export function gradeFor(score: number, t: Criteria["thresholds"]): Grade {
  if (score >= t.A) return "A";
  if (score >= t.B) return "B";
  if (score >= t.C) return "C";
  return "D";
}

/** 공통 하드 필터 판정. 켜진 필터 중 하나라도 불충족이면 제외. */
export function excludeReasons(job: Job, hf: Criteria["hardFilters"]): string[] {
  const r: string[] = [];
  const f = job.filterFlags;
  if (!f) return r;
  if (hf.noWrittenTest && f.hasWrittenTest) r.push("필기시험 있음");
  if (hf.regularOnly && !f.isRegular) r.push("정규직 아님");
  if (hf.newOrAny && !f.isNewOrAny) r.push("경력직 (신입·무관 아님)");
  if (hf.excludeSciTechPro && f.isSciTechPro) r.push("이과 전문직종");
  return r;
}

export interface ScoredJob extends Job {
  liveScore: number;
  liveGrade: Grade;
  excluded: boolean;
  excludedFor: string[];
}

export function applyCriteria(jobs: Job[], criteria: Criteria): ScoredJob[] {
  return jobs.map((j) => {
    const liveScore = scoreJob(j.breakdown, criteria.weights);
    const reasons = excludeReasons(j, criteria.hardFilters);
    return {
      ...j,
      liveScore,
      liveGrade: gradeFor(liveScore, criteria.thresholds),
      excluded: reasons.length > 0,
      excludedFor: reasons
    };
  });
}
