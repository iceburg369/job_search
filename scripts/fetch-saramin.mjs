/**
 * 사람인에서 공고를 가져오는 실제 구현을 여기에 연결하세요.
 *
 * export 규약:
 *   export async function fetchJobs(criteria) => Job[] | null
 *
 * Job 최소 형태:
 *   {
 *     id: string,                       // 사람인 rec_idx (지원상태 연결 키)
 *     company: string,
 *     role: string,
 *     breakdown: {                       // 각 0~5
 *       daegu, salary, companyValue, liberalArtsOk, benefits, majorAny, publicJob
 *     },
 *     filterFlags: {                     // 하드필터 판정용
 *       hasWrittenTest, isRegular, isNewOrAny, isSciTechPro   // boolean
 *     },
 *     location, employmentType, deadline, writtenTest,
 *     url, recIdx: number,
 *     matchReasons?: string[], missingKeywords?: string[], notes?: string|null
 *   }
 *
 * `criteria` 는 data/settings.json 의 criteria (weights/thresholds/hardFilters).
 * 점수(score/grade/weighted)는 반환하지 않아도 됩니다 — collect.mjs 가 현재 기준으로 채점합니다.
 *
 * 연결 방법 (택1):
 *   1) 사람인 오픈 API 키가 있으면 REST 호출 후 위 형태로 매핑
 *   2) 사내 크롤러/배치 산출물(파일·DB)을 읽어서 반환
 *   3) playMCP(사람인) MCP 를 쓰는 에이전트가 data/inbox/ranked-jobs.json 을 떨궈두게 하고
 *      이 파일은 그대로 null 반환 (collect.mjs 가 inbox 를 먼저 확인함)
 *
 * 미구현 상태에서는 null 을 반환 → collect.mjs 가 기존 공고를 현재 기준으로 재채점만 합니다.
 */
export async function fetchJobs(/* criteria */) {
  // TODO: 실제 사람인 연동
  return null;
}
