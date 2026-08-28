export type Grade = "A" | "B" | "C" | "D";

export const APPLY_STATUSES = ["미지원", "지원함", "서류통과", "탈락"] as const;
export type ApplyStatus = (typeof APPLY_STATUSES)[number];

/** 각 항목 0~5점. 가중치는 data/settings.json 의 criteria.weights 로 조정. */
export interface JobBreakdown {
  /** 1. 대구 지역이면 (가중치 x2) */
  daegu: number;
  /** 2. 신입 초봉 연봉 3천 이상 (x1) */
  salary: number;
  /** 3. 대기업 등 기업의 Value (x1) */
  companyValue: number;
  /** 4. 문과 출신이 지원 가능 (x1) */
  liberalArtsOk: number;
  /** 5. 복지 조건 (x1) */
  benefits: number;
  /** 6. 전공 무관 (x2) */
  majorAny: number;
  /** 7. 공무직 (x1) */
  publicJob: number;
}

/** 공통 하드 필터 판정용 플래그 (취합 시점에 기록). */
export interface JobFilterFlags {
  /** 채용 전형에 필기시험이 있는가 */
  hasWrittenTest: boolean;
  /** 정규직인가 */
  isRegular: boolean;
  /** 신입 또는 경력무관인가 (경력-only 면 false) */
  isNewOrAny: boolean;
  /** 이과 출신 전문직종인가 (엔지니어·연구·의료·개발 등) */
  isSciTechPro: boolean;
}

export interface Job {
  id: string;
  company: string;
  role: string;
  grade: Grade;
  /** 0~100 (기본 기준 스냅샷) */
  score: number;
  /** 가중합 (참고용) */
  weighted: number;
  breakdown: JobBreakdown;
  filterFlags: JobFilterFlags;
  location: string;
  employmentType: string;
  deadline: string;
  writtenTest: string;
  matchReasons: string[];
  missingKeywords: string[];
  notes?: string | null;
  url: string;
  /** 최신순 정렬 기준 (사람인 공고번호 = 등록시각과 단조 증가) */
  recIdx: number;
}

export interface RankedJobsFile {
  generatedAt?: string;
  source?: string;
  candidate?: string;
  criteria?: unknown;
  jobs: Job[];
}

export type StatusMap = Record<string, ApplyStatus>;

export const GRADES: Grade[] = ["A", "B", "C", "D"];

/* ---------- 평가 기준 (사용자 조정 가능) ---------- */

export type AxisKey =
  | "daegu"
  | "salary"
  | "companyValue"
  | "liberalArtsOk"
  | "benefits"
  | "majorAny"
  | "publicJob";

export type HardFilterKey = "noWrittenTest" | "regularOnly" | "newOrAny" | "excludeSciTechPro";

export interface Criteria {
  /** 각 축 가중치 (0 이상). 정규화되므로 절대값이 아니라 비율이 의미를 가짐 */
  weights: Record<AxisKey, number>;
  /** 점수(0~100) 등급 컷: score>=A→A, >=B→B, >=C→C, 그 외 D */
  thresholds: { A: number; B: number; C: number };
  /** 공통 하드 필터 (켜면 조건 불충족 공고를 '제외됨'으로 분리) */
  hardFilters: Record<HardFilterKey, boolean>;
}

export const AXES: { key: AxisKey; label: string; hint: string; defaultWeight: number }[] = [
  { key: "daegu", label: "대구 지역", hint: "근무지가 대구", defaultWeight: 2 },
  { key: "salary", label: "신입 초봉 3천+", hint: "신입 연봉 3,000만원 이상", defaultWeight: 1 },
  { key: "companyValue", label: "기업 Value", hint: "대기업·공공 등 회사 가치", defaultWeight: 1 },
  { key: "liberalArtsOk", label: "문과 지원 가능", hint: "문과 전공자 지원 가능", defaultWeight: 1 },
  { key: "benefits", label: "복지 조건", hint: "복리후생 수준", defaultWeight: 1 },
  { key: "majorAny", label: "전공 무관", hint: "전공 제한 없음", defaultWeight: 2 },
  { key: "publicJob", label: "공무직", hint: "공공기관·공기업·준공공", defaultWeight: 1 }
];

export const HARD_FILTERS: { key: HardFilterKey; label: string }[] = [
  { key: "noWrittenTest", label: "필기시험 없음" },
  { key: "regularOnly", label: "정규직만" },
  { key: "newOrAny", label: "신입·무관만 (경력 제외)" },
  { key: "excludeSciTechPro", label: "이과 전문직종 제외" }
];

export const DEFAULT_CRITERIA: Criteria = {
  weights: {
    daegu: 2,
    salary: 1,
    companyValue: 1,
    liberalArtsOk: 1,
    benefits: 1,
    majorAny: 2,
    publicJob: 1
  },
  thresholds: { A: 75, B: 60, C: 45 },
  hardFilters: {
    noWrittenTest: true,
    regularOnly: true,
    newOrAny: true,
    excludeSciTechPro: true
  }
};

/* ---------- 앱 설정 (평가 기준 + 일일 취합 시간) ---------- */

export interface AppSettings {
  criteria: Criteria;
  /** 매일 공고를 취합하는 시각. "HH:MM" 24시간 표기 */
  dailyCollectAt: string;
  /** 마지막 취합 완료 시각 (ISO). scripts/collect.mjs 가 기록 */
  lastCollectedAt: string | null;
  /** 마지막 취합 소스: "inbox" | "fetch-saramin" | "rescore" */
  lastCollectSource?: string | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  criteria: DEFAULT_CRITERIA,
  dailyCollectAt: "09:00",
  lastCollectedAt: null,
  lastCollectSource: null
};

/* ---------- 심층조사 (career-ops 부가기능 커스텀) ---------- */

export interface DeepDiveRewrite {
  before: string;
  after: string;
  why: string;
}
export interface DeepDiveStrength {
  point: string;
  evidence: string;
}
export interface DeepDiveGap {
  gap: string;
  severity: "high" | "med" | "low";
  mitigation: string;
}
export interface DeepDiveQA {
  question: string;
  starHint: string;
}

export interface DeepDive {
  id: string;
  generatedAt: string;
  verdict: {
    score: number;
    grade: Grade;
    recommend: string;
    oneLiner: string;
  };
  company: {
    profile: string;
    domain: string;
    culture: string;
    signals: string[];
    risks: string[];
  };
  role: {
    coreTasks: string[];
    mustHave: string[];
    niceToHave: string[];
    hiddenBar: string;
  };
  fitAnalysis: {
    strengths: DeepDiveStrength[];
    gaps: DeepDiveGap[];
    keywordCoverage: { covered: string[]; missing: string[] };
  };
  resumeRewrite: {
    summaryLine: string;
    bulletRewrites: DeepDiveRewrite[];
    addSections: string[];
    removeOrDownplay: string[];
    keywordsToInject: string[];
  };
  coverLetterAngle: string;
  interviewPrep: DeepDiveQA[];
  actionChecklist: string[];
  sources: string[];
}
