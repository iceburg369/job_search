"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_SETTINGS,
  GRADES,
  type AppSettings,
  type ApplyStatus,
  type Grade,
  type Job,
  type RankedJobsFile,
  type StatusMap
} from "@/lib/types";
import { applyCriteria } from "@/lib/score";
import { GradeBadge, ScoreBar, StatusSelect } from "./ui";
import DeepDiveDrawer from "./DeepDiveDrawer";
import SettingsPanel from "./SettingsPanel";

type View = "cards" | "table";
type SortKey = "score" | "company" | "recent";

const LS_STATUS = "jobboard:status:v1";
const LS_SETTINGS = "jobboard:settings:v1";
const LS_SETTINGS_SAVED = "jobboard:settings:saved:v1";

const isDefaultSettings = (s: AppSettings) =>
  JSON.stringify(s?.criteria) === JSON.stringify(DEFAULT_SETTINGS.criteria);

/** firstSeenAt(ISO)이 오늘(로컬 날짜)이면 true → "오늘 올라온" 공고. */
function isNewToday(iso?: string): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return d.toDateString() === new Date().toDateString();
}

function NewBadge() {
  return (
    <span className="badge-new" title="오늘 올라온 공고">
      NEW
    </span>
  );
}

function lsRead<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function lsWrite(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota / private mode */
  }
}

export default function Dashboard() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [meta, setMeta] = useState<Pick<RankedJobsFile, "generatedAt" | "source" | "candidate">>({});
  const [status, setStatus] = useState<StatusMap>({});
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [persistWarn, setPersistWarn] = useState(false);
  const [settingsWarn, setSettingsWarn] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [collectStatus, setCollectStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // 심층조사
  const [deepDiveIds, setDeepDiveIds] = useState<Set<string>>(new Set());
  const [openDeepDive, setOpenDeepDive] = useState<{
    id: string;
    title: string;
    score: number;
    grade: Grade;
  } | null>(null);

  // 필터/정렬/뷰
  const [view, setView] = useState<View>("cards");
  const [sort, setSort] = useState<SortKey>("score");
  const [activeGrades, setActiveGrades] = useState<Set<Grade>>(new Set(GRADES));
  const [query, setQuery] = useState("");

  const settingsSaveTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [jr, sr, dr, cr] = await Promise.all([
          fetch("/api/jobs", { cache: "no-store" }),
          fetch("/api/status", { cache: "no-store" }).catch(() => null),
          fetch("/api/deep-dive", { cache: "no-store" }).catch(() => null),
          fetch("/api/settings", { cache: "no-store" }).catch(() => null)
        ]);
        if (!jr.ok) {
          const body = await jr.json().catch(() => ({}));
          throw new Error(body.error || `공고 데이터를 불러오지 못했습니다 (${jr.status})`);
        }
        const file = (await jr.json()) as RankedJobsFile;
        if (!alive) return;
        setJobs(file.jobs ?? []);
        setMeta({ generatedAt: file.generatedAt, source: file.source, candidate: file.candidate });

        let sm: StatusMap = {};
        if (sr && sr.ok) {
          sm = (await sr.json()) as StatusMap;
          lsWrite(LS_STATUS, sm);
        } else {
          sm = lsRead<StatusMap>(LS_STATUS, {});
          setPersistWarn(true);
        }
        if (!alive) return;
        setStatus(sm);

        if (cr && cr.ok) {
          const serverSt = (await cr.json()) as AppSettings;
          const localSt = lsRead<AppSettings | null>(LS_SETTINGS, null);
          // 서버(Vercel 임시 저장소)가 콜드스타트로 초기화돼 기본값만 돌려주는데
          // 브라우저에 직접 저장했던 기준이 있으면 그쪽을 신뢰하고 다시 밀어넣는다.
          const localWins =
            !!localSt &&
            lsRead<boolean>(LS_SETTINGS_SAVED, false) &&
            isDefaultSettings(serverSt) &&
            !isDefaultSettings(localSt);
          const st = localWins ? (localSt as AppSettings) : serverSt;
          if (alive) {
            setSettings(st);
            lsWrite(LS_SETTINGS, st);
            if (localWins) {
              fetch("/api/settings", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(st)
              }).catch(() => {});
            }
          }
        } else {
          if (alive) {
            setSettings(lsRead<AppSettings>(LS_SETTINGS, DEFAULT_SETTINGS));
            setSettingsWarn(true);
          }
        }

        if (dr && dr.ok) {
          const { ids } = (await dr.json()) as { ids: string[] };
          if (alive) setDeepDiveIds(new Set(ids));
        }
      } catch (e) {
        if (alive) setLoadError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  function statusOf(id: string): ApplyStatus {
    return status[id] ?? "미지원";
  }

  function changeStatus(id: string, next: ApplyStatus) {
    setStatus((prev) => {
      const m = { ...prev };
      if (next === "미지원") delete m[id];
      else m[id] = next;
      lsWrite(LS_STATUS, m);
      return m;
    });
    fetch("/api/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, status: next })
    })
      .then((r) => {
        if (!r.ok) throw new Error();
        setPersistWarn(false);
      })
      .catch(() => setPersistWarn(true));
  }

  function updateSettings(next: AppSettings) {
    setSettings(next);
    lsWrite(LS_SETTINGS, next);
    clearTimeout(settingsSaveTimer.current);
    settingsSaveTimer.current = setTimeout(() => {
      fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next)
      })
        .then((r) => {
          if (!r.ok) throw new Error();
          setSettingsWarn(false);
          lsWrite(LS_SETTINGS_SAVED, true);
        })
        .catch(() => setSettingsWarn(true));
    }, 350);
  }

  async function applyAndCollect() {
    setCollecting(true);
    setCollectStatus(null);
    clearTimeout(settingsSaveTimer.current);
    try {
      // 1) 현재 기준을 즉시 저장 (디바운스 대기 없이)
      const sr = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings)
      });
      if (!sr.ok) throw new Error("평가 기준 저장 실패");
      setSettingsWarn(false);
      lsWrite(LS_SETTINGS_SAVED, true);

      // 2) 사람인 재취합 실행
      const cr = await fetch("/api/collect", { method: "POST" });
      const cj = await cr.json();
      if (!cr.ok) throw new Error(cj.error || `취합 실패 (${cr.status})`);

      // 3) 갱신된 공고·설정 다시 로드
      const [jr, s2] = await Promise.all([
        fetch("/api/jobs", { cache: "no-store" }),
        fetch("/api/settings", { cache: "no-store" })
      ]);
      const file = (await jr.json()) as RankedJobsFile;
      setJobs(file.jobs ?? []);
      setMeta({ generatedAt: file.generatedAt, source: file.source, candidate: file.candidate });
      if (s2.ok) {
        const st = (await s2.json()) as AppSettings;
        setSettings(st);
        lsWrite(LS_SETTINGS, st);
      }
      setCollectStatus({
        ok: true,
        msg: cj.message || `취합 완료 · ${cj.jobCount ?? file.jobs?.length ?? 0}건`
      });
    } catch (e) {
      setCollectStatus({ ok: false, msg: (e as Error).message });
    } finally {
      setCollecting(false);
    }
  }

  function toggleGrade(g: Grade) {
    setActiveGrades((prev) => {
      const n = new Set(prev);
      if (n.has(g)) n.delete(g);
      else n.add(g);
      return n;
    });
  }

  // ----- 평가 기준 적용: 각 공고에 liveScore / liveGrade / excluded 부여 -----
  const scored = useMemo(() => applyCriteria(jobs, settings.criteria), [jobs, settings.criteria]);
  const included = useMemo(() => scored.filter((j) => !j.excluded), [scored]);
  const excludedJobs = useMemo(
    () => scored.filter((j) => j.excluded).sort((a, b) => b.liveScore - a.liveScore),
    [scored]
  );

  // ----- 요약 (하드필터 통과분 기준) -----
  const summary = useMemo(() => {
    const byGrade: Record<Grade, number> = { A: 0, B: 0, C: 0, D: 0 };
    let sum = 0;
    for (const j of included) {
      byGrade[j.liveGrade] += 1;
      sum += j.liveScore;
    }
    return {
      total: included.length,
      excluded: excludedJobs.length,
      newToday: scored.filter((j) => isNewToday(j.firstSeenAt)).length,
      byGrade,
      avg: included.length ? Math.round((sum / included.length) * 10) / 10 : 0
    };
  }, [included, excludedJobs, scored]);

  // ----- 필터 + 정렬 -----
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = included.filter((j) => {
      if (!activeGrades.has(j.liveGrade)) return false;
      if (!q) return true;
      const hay = [
        j.company,
        j.role,
        j.location,
        j.employmentType,
        ...j.matchReasons,
        ...j.missingKeywords
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });

    const sorted = [...filtered];
    if (sort === "score") {
      sorted.sort((a, b) => b.liveScore - a.liveScore || a.company.localeCompare(b.company, "ko"));
    } else if (sort === "company") {
      sorted.sort((a, b) => a.company.localeCompare(b.company, "ko"));
    } else {
      sorted.sort((a, b) => b.recIdx - a.recIdx);
    }
    return sorted;
  }, [included, activeGrades, query, sort]);

  if (loading) {
    return <div className="banner">데이터를 불러오는 중…</div>;
  }
  if (loadError) {
    return (
      <div className="banner banner--error">
        {loadError}
        <br />
        <code>data/ranked-jobs.json</code> 이 있는지, 개발 서버가 프로젝트 루트에서 실행 중인지
        확인하세요.
      </div>
    );
  }

  return (
    <>
      {persistWarn && (
        <div className="banner banner--error">
          지원상태를 서버(<code>data/status.json</code>)에 저장하지 못했습니다. 현재는 브라우저
          localStorage 백업에만 반영됩니다.
        </div>
      )}

      {/* 1. 상단 요약 */}
      <section className="summary">
        <div className="stat">
          <div className="stat__label">공고 수 (필터 통과)</div>
          <div className="stat__value">
            {summary.total}
            {summary.newToday > 0 && (
              <span className="stat__sub stat__sub--new"> · 오늘 신규 {summary.newToday}</span>
            )}
            {summary.excluded > 0 && (
              <span className="stat__sub"> · 제외 {summary.excluded}</span>
            )}
          </div>
        </div>
        <div className="stat">
          <div className="stat__label">등급별 개수</div>
          <div className="stat__grades" style={{ marginTop: 6 }}>
            {GRADES.map((g) => (
              <span className="stat__grade" key={g}>
                <GradeBadge grade={g} />
                <b>{summary.byGrade[g]}</b>
              </span>
            ))}
          </div>
        </div>
        <div className="stat">
          <div className="stat__label">평균 점수</div>
          <div className="stat__value">{summary.avg}</div>
        </div>
        <div className="stat">
          <div className="stat__label">데이터 기준</div>
          <div className="stat__value" style={{ fontSize: 15, fontWeight: 560 }}>
            {meta.generatedAt ?? "—"}
          </div>
        </div>
      </section>

      {/* 평가 기준 · 일일 취합 설정 */}
      <SettingsPanel
        settings={settings}
        onChange={updateSettings}
        onApply={applyAndCollect}
        collecting={collecting}
        collectStatus={collectStatus}
        saveWarn={settingsWarn}
      />

      {/* 2. 툴바 */}
      <div className="toolbar">
        <div className="field">
          <label htmlFor="q">검색</label>
          <input
            id="q"
            className="input"
            placeholder="회사·직무·키워드"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="field">
          <label>등급</label>
          <div className="chips">
            {GRADES.map((g) => (
              <button
                key={g}
                className="chip"
                aria-pressed={activeGrades.has(g)}
                onClick={() => toggleGrade(g)}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="sort">정렬</label>
          <select
            id="sort"
            className="select"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            <option value="score">점수순</option>
            <option value="company">회사순</option>
            <option value="recent">최신순</option>
          </select>
        </div>

        <div className="toolbar__spacer" />

        <span className="count">
          {visible.length} / {summary.total}
        </span>
        <div className="seg" role="group" aria-label="보기 전환">
          <button aria-pressed={view === "cards"} onClick={() => setView("cards")}>
            카드
          </button>
          <button aria-pressed={view === "table"} onClick={() => setView("table")}>
            테이블
          </button>
        </div>
      </div>

      {/* 2/3. 리스트 */}
      {visible.length === 0 ? (
        <div className="empty">조건에 맞는 공고가 없습니다.</div>
      ) : view === "cards" ? (
        <div className="cards">
          {visible.map((j) => (
            <article className="job" key={j.id}>
              <div className="job__top">
                <div>
                  <div className="job__company">
                    {isNewToday(j.firstSeenAt) && <NewBadge />}
                    {j.company}
                  </div>
                  <div className="job__role">{j.role}</div>
                </div>
                <GradeBadge grade={j.liveGrade} />
              </div>

              <ScoreBar score={j.liveScore} grade={j.liveGrade} />

              <div className="job__meta">
                <span>📍 {j.location}</span>
                <span>· {j.employmentType}</span>
                <span>· 마감 {j.deadline}</span>
                <span>· 필기 {j.writtenTest}</span>
              </div>

              <div>
                <div className="section-label">매칭 이유</div>
                <ul className="reasons">
                  {j.matchReasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>

              {j.missingKeywords.length > 0 && (
                <div>
                  <div className="section-label">부족 키워드</div>
                  <div className="kw">
                    {j.missingKeywords.map((k, i) => (
                      <span className="kw__tag" key={i}>
                        {k}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {j.notes && <div className="note">{j.notes}</div>}

              <div className="job__foot">
                <StatusSelect value={statusOf(j.id)} onChange={(s) => changeStatus(j.id, s)} />
                <div className="job__foot-right">
                  <button
                    className="dd-btn"
                    data-available={deepDiveIds.has(j.id)}
                    onClick={() =>
                      setOpenDeepDive({
                        id: j.id,
                        title: `${j.company} · ${j.role}`,
                        score: j.liveScore,
                        grade: j.liveGrade
                      })
                    }
                    title={
                      deepDiveIds.has(j.id)
                        ? "회사·직무 심층 분석 + 이력서 수정 인사이트"
                        : "이 공고는 아직 심층조사 전"
                    }
                  >
                    {deepDiveIds.has(j.id) ? "🔍 심층조사" : "심층조사"}
                  </button>
                  <a className="link" href={j.url} target="_blank" rel="noreferrer">
                    원본 공고 ↗
                  </a>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="table-scroll">
          <table className="jobs">
            <thead>
              <tr>
                <th>등급</th>
                <th>점수</th>
                <th>회사</th>
                <th>직무</th>
                <th>근무조건</th>
                <th>매칭 이유 / 부족 키워드</th>
                <th>지원상태</th>
                <th>심층조사 / 링크</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((j) => (
                <tr key={j.id}>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {isNewToday(j.firstSeenAt) && <NewBadge />}
                    <GradeBadge grade={j.liveGrade} />
                  </td>
                  <td>
                    <ScoreBar score={j.liveScore} grade={j.liveGrade} />
                  </td>
                  <td>{j.company}</td>
                  <td>{j.role}</td>
                  <td style={{ whiteSpace: "nowrap", color: "var(--text-muted)", fontSize: 12 }}>
                    {j.location}
                    <br />
                    {j.employmentType} · 마감 {j.deadline}
                    <br />
                    필기 {j.writtenTest}
                  </td>
                  <td className="td-reasons">
                    {j.matchReasons.slice(0, 2).join(" / ")}
                    {j.missingKeywords.length > 0 && (
                      <>
                        <br />
                        <span style={{ color: "var(--text-faint)" }}>
                          부족: {j.missingKeywords.join(", ")}
                        </span>
                      </>
                    )}
                  </td>
                  <td>
                    <StatusSelect value={statusOf(j.id)} onChange={(s) => changeStatus(j.id, s)} />
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button
                      className="dd-btn"
                      data-available={deepDiveIds.has(j.id)}
                      onClick={() =>
                        setOpenDeepDive({
                          id: j.id,
                          title: `${j.company} · ${j.role}`,
                          score: j.liveScore,
                          grade: j.liveGrade
                        })
                      }
                    >
                      {deepDiveIds.has(j.id) ? "🔍 심층조사" : "심층조사"}
                    </button>
                    <br />
                    <a className="link" href={j.url} target="_blank" rel="noreferrer">
                      공고 ↗
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {excludedJobs.length > 0 && (
        <details className="excluded">
          <summary>
            공통 조건에서 제외됨 <b>{excludedJobs.length}</b>
            <span className="excluded__hint">
              (필기시험·정규직·신입무관·이과전문직 필터 — 패널에서 해제 가능)
            </span>
          </summary>
          <ul className="excluded__list">
            {excludedJobs.map((j) => (
              <li key={j.id}>
                <span className={`grade grade--${j.liveGrade}`}>{j.liveGrade}</span>
                {isNewToday(j.firstSeenAt) && <NewBadge />}
                <span className="excluded__score">{j.liveScore}</span>
                <span className="excluded__co">{j.company}</span>
                <span className="excluded__role">{j.role}</span>
                <span className="excluded__loc">{j.location}</span>
                {j.excludedFor.map((r, i) => (
                  <span className="excluded__reason" key={i}>
                    {r}
                  </span>
                ))}
                <button
                  className="dd-btn"
                  data-available={deepDiveIds.has(j.id)}
                  onClick={() =>
                    setOpenDeepDive({
                      id: j.id,
                      title: `${j.company} · ${j.role}`,
                      score: j.liveScore,
                      grade: j.liveGrade
                    })
                  }
                >
                  {deepDiveIds.has(j.id) ? "🔍 심층조사" : "심층조사"}
                </button>
                <a className="link" href={j.url} target="_blank" rel="noreferrer">
                  공고 ↗
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="foot-hint">
        {meta.source ? `${meta.source} · ` : ""}
        {meta.candidate ?? ""}
      </p>

      {openDeepDive && (
        <DeepDiveDrawer
          jobId={openDeepDive.id}
          title={openDeepDive.title}
          liveScore={openDeepDive.score}
          liveGrade={openDeepDive.grade}
          onClose={() => setOpenDeepDive(null)}
        />
      )}
    </>
  );
}
