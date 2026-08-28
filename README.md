# 취업 상황판 (Job Status Board)

`data/ranked-jobs.json` 을 데이터 소스로 쓰는 정적 대시보드. **DB 없음.**

## 스택
- Next.js 14 (App Router) + TypeScript
- 데이터: `data/ranked-jobs.json` (읽기), `data/status.json` (지원상태 저장)
- 지원상태는 서버 파일 저장 + `localStorage` 백업

## 실행
```bash
npm install
npm run dev      # http://localhost:3000
```
프로덕션:
```bash
npm run build && npm start
```
> API 라우트가 프로젝트 루트의 `data/` 폴더를 직접 읽고 쓰므로, **프로젝트 루트에서** 실행해야 합니다.

## 화면
1. **상단 요약** — 공고 수(필터 통과 · 제외 N) / 등급별 개수(A·B·C·D) / 평균 점수 / 데이터 기준일
2. **공고 리스트** — 카드 ↔ 테이블 토글 (하드필터 통과분만)
   - 표시: 회사, 직무, 등급 뱃지, 점수(바+숫자), 매칭 이유, 부족 키워드, 원본 링크
   - 정렬: 점수순 / 회사순 / 최신순(`recIdx` = 사람인 공고번호)
   - 필터: 등급 칩(A~D), 키워드 검색(회사·직무·이유·키워드·지역)
3. **지원상태 관리** — 공고별 드롭다운: 미지원 / 지원함 / 서류통과 / 탈락
   - 변경 시 `POST /api/status` → `data/status.json` 저장, 동시에 `localStorage` 백업
   - 서버 저장 실패 시 배너 표시 + `localStorage` 로만 유지
4. **심층조사 (career-ops 부가기능 커스텀)** — 공고 카드/행의 `🔍 심층조사` 버튼
   - 클릭 시 우측 드로어로 리포트 표시: 종합 판단 → 회사 분석 → 직무 분석 → 적합도 분석(강점/격차/키워드 커버리지) → **이력서 수정 인사이트**(맞춤 한 줄 소개, BEFORE→AFTER 불릿 재작성, 추가/삭제 항목, ATS 삽입 키워드) → 자기소개서 앵글 → 면접 준비(STAR+회고) → 지원 전 체크리스트 → 근거/한계
   - 드로어 상단 점수·등급은 **현재 평가 기준으로 재계산된 값**을 보여주고, 리포트 작성 시점 값과 다르면 캡션으로 병기
   - `MD 복사` 버튼으로 리포트 전체를 마크다운으로 클립보드 복사
   - 데이터: `data/deep-dives/{공고id}.json` (정적 파일). 파일이 있으면 버튼이 강조색으로 활성화, 없으면 회색 + 드로어에 "추가 방법" 안내(에러 아님)
   - 현행 취합본용 리포트 10건: 이음앤·법무법인삼일·아이파킹·경산상공회의소·법무법인테헤란·영솔라에너지·조선아이디(청주)·브이토리(청주) + 제외 섹션의 LH·한국나눔연맹
   - `data/deep-dives/` 의 `54870862/54871170/54870961/54871492/54871525.json` 은 이전(HR·서울) 공고용 orphan — 현재 목록과 매칭되지 않으니 삭제 가능
5. **제외됨 섹션** — 리스트 하단 접이식. 공통 하드필터에 걸린 공고를 사유 칩(정규직 아님 / 경력직 / 이과 전문직종 / 필기시험 있음)과 함께 표시. 필터를 끄면 즉시 본 리스트로 복귀.
6. **평가 기준 · 일일 취합 설정** — 요약 아래 접이식 패널
   - **평가 기준 (7축)**: 대구 지역(×2) / 신입 초봉 3천+(×1) / 기업 Value(×1) / 문과 지원 가능(×1) / 복지 조건(×1) / 전공 무관(×2) / 공무직(×1) — 각 가중치를 슬라이더로 조정
   - **공통 조건 (하드 필터)**: 필기시험 없음 · 정규직만 · 신입·무관만(경력 제외) · 이과 전문직종 제외 — 체크박스로 on/off. 끄면 해당 제외 공고가 본 리스트로 복귀
   - **등급 컷** A/B/C 점수 직접 입력. `기본값 복원` 버튼
   - 슬라이더·컷·필터를 바꾸면 화면은 **즉시 미리보기**로 재계산(저장은 350ms 디바운스 자동)
   - **`적용 · 사람인 재취합` 버튼**: 현재 기준을 즉시 저장 → `POST /api/collect` 로 `scripts/collect.mjs` 실행 → 갱신된 `ranked-jobs.json`·설정을 다시 로드. 버튼은 실행 중 `취합 중…` 으로 비활성화, 완료 후 결과 메시지(취합 건수·소스) 표시
   - **일일 취합 시간**: `<input type="time">` + "다음 취합까지 N시간" 카운트다운 + 마지막 취합 시각·소스
   - 저장: `POST /api/settings`(디바운스) → `data/settings.json`, 동시에 `localStorage` 백업. 서버 실패 시 패널에 경고

## 평가 기준 변경 (`data/settings.json`)
`{ criteria: { weights(7축), thresholds, hardFilters(4개) }, dailyCollectAt, lastCollectedAt }`. UI에서 바꾸면 이 파일이 갱신되고, 파일을 직접 수정한 뒤 새로고침해도 반영됩니다. 각 공고의 축별 원점수(0~5)와 필터 플래그는 `ranked-jobs.json` 의 `breakdown`·`filterFlags` 이며, 이건 취합 시점에 고정되고 패널에서는 가중치·컷·필터 on/off 만 조정합니다.

## 재취합 파이프라인 (`적용` 버튼 / `npm run collect` / 스케줄러)

세 경로 모두 같은 `scripts/collect.mjs` 를 실행합니다:
- **앱의 `적용 · 사람인 재취합` 버튼** → `POST /api/collect` → 스크립트를 spawn
- **`npm run collect`** (수동)
- **OS 스케줄러** — `data/settings.json` 의 `dailyCollectAt` 시각으로 등록:
  ```bash
  # Windows 작업 스케줄러
  schtasks /create /tn "job-collect" /tr "cmd /c cd /d D:\job && npm run collect" /sc daily /st 09:00
  # cron
  0 9 * * *  cd /path/to/job && npm run collect
  ```

`collect.mjs` 가 하는 일:
1. `data/settings.json` 의 평가 기준(weights/thresholds/hardFilters) 읽기
2. **새 공고 확보** — 아래 순서로 시도 (먼저 성공하는 소스 사용):
   - `data/inbox/ranked-jobs.json` … playMCP(사람인) MCP 를 쓸 수 있는 에이전트/사람이 새 취합 결과를 이 경로에 저장해 두면 흡수 후 `data/inbox/processed-<ts>.json` 으로 이동
   - `scripts/fetch-saramin.mjs` 의 `export async function fetchJobs(criteria)` … 사람인 오픈 API / 사내 크롤러 연결 지점 (현재 stub, `null` 반환)
   - 둘 다 없으면 → 기존 `ranked-jobs.json` 유지 (`source: "rescore"`)
3. 모든 공고를 현재 기준으로 **재채점** (`id` 유지 → 지원상태 연결 보존)
4. `ranked-jobs.json` 갱신, `settings.json` 에 `lastCollectedAt` / `lastCollectSource` 기록

> ⚠ Next.js 서버는 playMCP(사람인) MCP 를 직접 호출할 수 없습니다. "사람인에서 실제로 다시 불러오기"는 `fetch-saramin.mjs` 를 실제 API/크롤러에 연결하거나, MCP 에이전트가 `data/inbox/ranked-jobs.json` 을 떨궈두는 방식으로 활성화됩니다. 그 전까지 `적용` 버튼은 **현재 기준으로 재채점 + 목록 새로고침**까지 수행합니다.

## 데이터 스키마 (`data/ranked-jobs.json`)
```jsonc
{
  "generatedAt": "2026-08-27",
  "source": "…",
  "candidate": "…",
  "jobs": [
    {
      "id": "54870862",              // 고유 키 (status.json 키로 사용)
      "company": "…",
      "role": "…",
      "grade": "A",                  // 기본 기준 스냅샷 (앱은 breakdown+settings로 재계산)
      "score": 80,                    // 기본 기준 스냅샷
      "weighted": 36,                 // 참고용
      "breakdown": {                  // 7축, 각 0~5, 실제 채점 입력값
        "daegu": 5, "salary": 4, "companyValue": 3, "liberalArtsOk": 5,
        "benefits": 3, "majorAny": 5, "publicJob": 1
      },
      "filterFlags": {                // 하드필터 판정용 (취합 시점 고정)
        "hasWrittenTest": false, "isRegular": true,
        "isNewOrAny": true, "isSciTechPro": false
      },
      "location": "…",
      "employmentType": "신입·경력",
      "deadline": "D-17",
      "writtenTest": "없음(추정)",
      "matchReasons": ["…"],
      "missingKeywords": ["…"],
      "notes": "…",                  // null 가능
      "url": "https://…",
      "recIdx": 54870862             // 최신순 정렬 기준
    }
  ]
}
```
등급 기준·가중치·하드필터는 앱의 **평가 기준 패널**에서 조정. 기본값: 가중치 `대구 2 : 초봉3천 1 : 기업Value 1 : 문과가능 1 : 복지 1 : 전공무관 2 : 공무직 1`, 컷 `A ≥ 75 · B ≥ 60 · C ≥ 45 · 그 외 D`, 하드필터 4개 모두 ON. `ranked-jobs.json` 의 `score`/`grade` 는 이 기본값 스냅샷일 뿐, 화면 값은 `breakdown`·`filterFlags` + `data/settings.json` 으로 매번 재계산됩니다.

### 현행 취합본 (대구 재취합, 2026-08-27)
사람인 대구 지역 재검색 → 공통 조건(필기 없음·정규직·신입/무관·이과 전문직 제외)으로 필터 → 7축 채점. **통과 14건 / 제외 6건.** 지원자 프로필은 Google Drive `정연/자소서`(행복모아 인사담당자 자소서 v1.7)에서 확인: 계명대 중국어중국학과(문과), 대구 거주, 신입, 정규직 희망, 희망연봉 3,000만원 내외.

## 성공 기준 대응
- **`ranked-jobs.json` 갱신 → 새로고침만으로 반영**: `page.tsx` `dynamic = "force-dynamic"` + `/api/jobs` 가 `no-store` 로 매 요청 파일 재읽기.
- **상태 변경이 새로고침 후에도 유지**: `data/status.json` 파일 저장 + `localStorage` 백업, 로드 시 서버값 우선·실패 시 백업.

## 데이터 갱신
`data/ranked-jobs.json` 을 새 평가 결과로 덮어쓰고 브라우저 새로고침. `id` 는 유지해야 기존 지원상태가 이어집니다. 삭제된 `id` 의 상태는 `status.json` 에 남아도 화면에는 표시되지 않습니다.

## 심층조사 리포트 추가 (`data/deep-dives/{id}.json`)
새 공고에 대한 심층조사를 붙이려면 `data/deep-dives/` 에 `{공고id}.json` 을 추가하면 됩니다(서버 재시작 불필요, 새로고침만). 스키마는 `lib/types.ts` 의 `DeepDive` 인터페이스와 기존 파일(`data/deep-dives/54870862.json`)을 참고하세요.

| 필드 | 내용 |
|---|---|
| `verdict` | `{ score, grade, recommend, oneLiner }` — 종합 판단 |
| `company` | `{ profile, domain, culture, signals[], risks[] }` |
| `role` | `{ coreTasks[], mustHave[], niceToHave[], hiddenBar }` |
| `fitAnalysis` | `{ strengths[{point,evidence}], gaps[{gap,severity,mitigation}], keywordCoverage{covered[],missing[]} }` |
| `resumeRewrite` | `{ summaryLine, bulletRewrites[{before,after,why}], addSections[], removeOrDownplay[], keywordsToInject[] }` |
| `coverLetterAngle` | 자기소개서 앵글 (문자열) |
| `interviewPrep` | `[{ question, starHint }]` |
| `actionChecklist` | 지원 전 할 일 (문자열 배열) |
| `sources` | 근거·한계 (문자열 배열) |
