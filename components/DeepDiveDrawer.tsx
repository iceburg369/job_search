"use client";

import { useCallback, useEffect, useState } from "react";
import type { DeepDive, Grade } from "@/lib/types";

const SEV_LABEL: Record<DeepDive["fitAnalysis"]["gaps"][number]["severity"], string> = {
  high: "치명",
  med: "보통",
  low: "경미"
};

function toMarkdown(d: DeepDive, title: string): string {
  const L: string[] = [];
  L.push(`# 심층조사 — ${title}`);
  L.push(`_생성: ${d.generatedAt} · career-ops 커스텀 리포트_\n`);

  L.push(`## 종합 판단`);
  L.push(`- **점수/등급**: ${d.verdict.score} · ${d.verdict.grade}`);
  L.push(`- **권고**: ${d.verdict.recommend}`);
  L.push(`- ${d.verdict.oneLiner}\n`);

  L.push(`## 회사 분석`);
  L.push(`- **개요**: ${d.company.profile}`);
  L.push(`- **도메인**: ${d.company.domain}`);
  L.push(`- **문화(추정)**: ${d.company.culture}`);
  L.push(`- **긍정 시그널**:`);
  d.company.signals.forEach((s) => L.push(`  - ${s}`));
  L.push(`- **리스크**:`);
  d.company.risks.forEach((s) => L.push(`  - ${s}`));
  L.push("");

  L.push(`## 직무 분석`);
  L.push(`- **핵심 업무(추정)**:`);
  d.role.coreTasks.forEach((s) => L.push(`  - ${s}`));
  L.push(`- **필수**: ${d.role.mustHave.join(", ")}`);
  L.push(`- **우대**: ${d.role.niceToHave.join(", ")}`);
  L.push(`- **숨은 합격 기준**: ${d.role.hiddenBar}\n`);

  L.push(`## 적합도 분석`);
  L.push(`### 강점`);
  d.fitAnalysis.strengths.forEach((s) => L.push(`- **${s.point}** — ${s.evidence}`));
  L.push(`### 격차`);
  d.fitAnalysis.gaps.forEach((g) =>
    L.push(`- **${g.gap}** _(${SEV_LABEL[g.severity]})_ → ${g.mitigation}`)
  );
  L.push(`### 키워드 커버리지`);
  L.push(`- 보유: ${d.fitAnalysis.keywordCoverage.covered.join(", ")}`);
  L.push(`- 부족: ${d.fitAnalysis.keywordCoverage.missing.join(", ")}\n`);

  L.push(`## 이력서 수정 인사이트`);
  L.push(`**맞춤 한 줄 소개**\n> ${d.resumeRewrite.summaryLine}\n`);
  L.push(`**불릿 재작성**`);
  d.resumeRewrite.bulletRewrites.forEach((b, i) => {
    L.push(`${i + 1}. BEFORE: ${b.before}`);
    L.push(`   AFTER: ${b.after}`);
    L.push(`   WHY: ${b.why}`);
  });
  L.push(`**추가할 항목**`);
  d.resumeRewrite.addSections.forEach((s) => L.push(`- ${s}`));
  L.push(`**빼거나 줄일 항목**`);
  d.resumeRewrite.removeOrDownplay.forEach((s) => L.push(`- ${s}`));
  L.push(`**삽입 키워드(ATS)**: ${d.resumeRewrite.keywordsToInject.join(", ")}\n`);

  L.push(`## 자기소개서 앵글`);
  L.push(`${d.coverLetterAngle}\n`);

  L.push(`## 면접 준비 (STAR + 회고)`);
  d.interviewPrep.forEach((qa, i) => {
    L.push(`${i + 1}. Q. ${qa.question}`);
    L.push(`   → ${qa.starHint}`);
  });
  L.push("");

  L.push(`## 지원 전 체크리스트`);
  d.actionChecklist.forEach((s) => L.push(`- [ ] ${s}`));
  L.push("");

  L.push(`## 근거 / 한계`);
  d.sources.forEach((s) => L.push(`- ${s}`));

  return L.join("\n");
}

export default function DeepDiveDrawer({
  jobId,
  title,
  liveScore,
  liveGrade,
  onClose
}: {
  jobId: string;
  title: string;
  liveScore?: number;
  liveGrade?: Grade;
  onClose: () => void;
}) {
  const [data, setData] = useState<DeepDive | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [errMsg, setErrMsg] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setState("loading");
    fetch(`/api/deep-dive?id=${encodeURIComponent(jobId)}`, { cache: "no-store" })
      .then(async (r) => {
        if (r.status === 404) {
          if (alive) setState("missing");
          return;
        }
        if (!r.ok) throw new Error(`요청 실패 (${r.status})`);
        const json = (await r.json()) as DeepDive;
        if (alive) {
          setData(json);
          setState("ready");
        }
      })
      .catch((e) => {
        if (alive) {
          setErrMsg((e as Error).message);
          setState("error");
        }
      });
    return () => {
      alive = false;
    };
  }, [jobId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const copyMd = useCallback(async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(toMarkdown(data, title));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }, [data, title]);

  return (
    <div className="dd-overlay" onMouseDown={onClose}>
      <aside
        className="dd-panel"
        role="dialog"
        aria-modal="true"
        aria-label="심층조사 리포트"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="dd-head">
          <div>
            <div className="dd-kicker">심층조사 · career-ops 커스텀</div>
            <h2 className="dd-title">{title}</h2>
          </div>
          <div className="dd-head-actions">
            {state === "ready" && (
              <button className="btn-ghost" onClick={copyMd}>
                {copied ? "복사됨" : "MD 복사"}
              </button>
            )}
            <button className="btn-ghost" onClick={onClose} aria-label="닫기">
              ✕
            </button>
          </div>
        </header>

        <div className="dd-body">
          {state === "loading" && <p className="dd-muted">리포트를 불러오는 중…</p>}

          {state === "error" && (
            <p className="dd-muted">불러오기 실패: {errMsg}</p>
          )}

          {state === "missing" && (
            <div className="dd-missing">
              <p>
                <b>{title}</b> 의 심층조사 리포트가 아직 없습니다.
              </p>
              <p className="dd-muted">
                리포트가 있는 공고는 카드/행의 버튼이 보라색으로 채워져 있습니다. 이 공고에 리포트를
                추가하려면 아래 경로에 JSON 파일을 만드세요 — 서버 재시작 없이 새로고침만 하면
                반영됩니다.
              </p>
              <pre className="dd-code">data/deep-dives/{jobId}.json</pre>
              <p className="dd-muted">
                형식은 <code>lib/types.ts</code> 의 <code>DeepDive</code> 인터페이스, 또는 이미 있는
                리포트 파일을 참고하세요. 필드: verdict · company · role · fitAnalysis ·
                resumeRewrite · coverLetterAngle · interviewPrep · actionChecklist · sources.
              </p>
            </div>
          )}

          {state === "ready" && data && (
            <>
              <section className="dd-sec dd-verdict">
                <div className="dd-verdict-row">
                  <span className={`grade grade--${liveGrade ?? data.verdict.grade}`}>
                    {liveGrade ?? data.verdict.grade}
                  </span>
                  <span className="dd-score">{liveScore ?? data.verdict.score}</span>
                  <span className="dd-recommend">{data.verdict.recommend}</span>
                </div>
                {typeof liveScore === "number" &&
                  (liveScore !== data.verdict.score || liveGrade !== data.verdict.grade) && (
                    <p className="dd-foot">
                      현재 평가 기준 적용 · 리포트 작성 시점: {data.verdict.grade} {data.verdict.score}
                    </p>
                  )}
                <p className="dd-oneliner">{data.verdict.oneLiner}</p>
              </section>

              <section className="dd-sec">
                <h3>회사 분석</h3>
                <dl className="dd-dl">
                  <dt>개요</dt>
                  <dd>{data.company.profile}</dd>
                  <dt>도메인</dt>
                  <dd>{data.company.domain}</dd>
                  <dt>문화(추정)</dt>
                  <dd>{data.company.culture}</dd>
                </dl>
                <div className="dd-cols">
                  <div>
                    <div className="section-label">긍정 시그널</div>
                    <ul className="dd-list">
                      {data.company.signals.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="section-label">리스크</div>
                    <ul className="dd-list dd-list--warn">
                      {data.company.risks.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </section>

              <section className="dd-sec">
                <h3>직무 분석</h3>
                <div className="section-label">핵심 업무(추정)</div>
                <ul className="dd-list">
                  {data.role.coreTasks.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
                <div className="dd-kw">
                  <span className="section-label">필수</span>
                  {data.role.mustHave.map((k, i) => (
                    <span className="kw__tag" key={i}>
                      {k}
                    </span>
                  ))}
                </div>
                <div className="dd-kw">
                  <span className="section-label">우대</span>
                  {data.role.niceToHave.map((k, i) => (
                    <span className="kw__tag" key={i}>
                      {k}
                    </span>
                  ))}
                </div>
                <p className="note">숨은 합격 기준 — {data.role.hiddenBar}</p>
              </section>

              <section className="dd-sec">
                <h3>적합도 분석</h3>
                <div className="section-label">강점</div>
                <ul className="dd-list">
                  {data.fitAnalysis.strengths.map((s, i) => (
                    <li key={i}>
                      <b>{s.point}</b> — <span className="dd-muted">{s.evidence}</span>
                    </li>
                  ))}
                </ul>
                <div className="section-label">격차 &amp; 보완책</div>
                <ul className="dd-list">
                  {data.fitAnalysis.gaps.map((g, i) => (
                    <li key={i}>
                      <span className={`sev sev--${g.severity}`}>{SEV_LABEL[g.severity]}</span>{" "}
                      <b>{g.gap}</b>
                      <br />
                      <span className="dd-muted">→ {g.mitigation}</span>
                    </li>
                  ))}
                </ul>
                <div className="dd-kw">
                  <span className="section-label">보유 키워드</span>
                  {data.fitAnalysis.keywordCoverage.covered.map((k, i) => (
                    <span className="kw__tag kw__tag--ok" key={i}>
                      {k}
                    </span>
                  ))}
                </div>
                <div className="dd-kw">
                  <span className="section-label">부족 키워드</span>
                  {data.fitAnalysis.keywordCoverage.missing.map((k, i) => (
                    <span className="kw__tag" key={i}>
                      {k}
                    </span>
                  ))}
                </div>
              </section>

              <section className="dd-sec dd-sec--accent">
                <h3>이력서 수정 인사이트</h3>
                <div className="section-label">맞춤 한 줄 소개</div>
                <blockquote className="dd-quote">{data.resumeRewrite.summaryLine}</blockquote>

                <div className="section-label">불릿 재작성</div>
                <ol className="dd-rewrites">
                  {data.resumeRewrite.bulletRewrites.map((b, i) => (
                    <li key={i}>
                      <div className="dd-before">
                        <span>BEFORE</span> {b.before}
                      </div>
                      <div className="dd-after">
                        <span>AFTER</span> {b.after}
                      </div>
                      <div className="dd-why">왜 — {b.why}</div>
                    </li>
                  ))}
                </ol>

                <div className="dd-cols">
                  <div>
                    <div className="section-label">추가할 항목</div>
                    <ul className="dd-list">
                      {data.resumeRewrite.addSections.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="section-label">빼거나 줄일 항목</div>
                    <ul className="dd-list">
                      {data.resumeRewrite.removeOrDownplay.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div className="dd-kw">
                  <span className="section-label">삽입 키워드(ATS)</span>
                  {data.resumeRewrite.keywordsToInject.map((k, i) => (
                    <span className="kw__tag kw__tag--inject" key={i}>
                      {k}
                    </span>
                  ))}
                </div>
              </section>

              <section className="dd-sec">
                <h3>자기소개서 앵글</h3>
                <p>{data.coverLetterAngle}</p>
              </section>

              <section className="dd-sec">
                <h3>면접 준비 · STAR + 회고</h3>
                <ol className="dd-qa">
                  {data.interviewPrep.map((qa, i) => (
                    <li key={i}>
                      <div className="dd-q">Q. {qa.question}</div>
                      <div className="dd-a dd-muted">→ {qa.starHint}</div>
                    </li>
                  ))}
                </ol>
              </section>

              <section className="dd-sec">
                <h3>지원 전 체크리스트</h3>
                <ul className="dd-check">
                  {data.actionChecklist.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
              </section>

              <section className="dd-sec">
                <h3>근거 / 한계</h3>
                <ul className="dd-list dd-muted">
                  {data.sources.map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ul>
                <p className="dd-foot">생성 {data.generatedAt} · 공개 정보 + 이력서 기반 추정</p>
              </section>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
