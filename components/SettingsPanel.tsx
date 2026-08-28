"use client";

import { useEffect, useState } from "react";
import {
  AXES,
  DEFAULT_SETTINGS,
  HARD_FILTERS,
  type AppSettings,
  type AxisKey,
  type HardFilterKey
} from "@/lib/types";

function nextRun(hhmm: string): { when: Date; label: string; inMs: number } {
  const [h, m] = hhmm.split(":").map(Number);
  const now = new Date();
  const when = new Date(now);
  when.setHours(h, m, 0, 0);
  let label = "오늘";
  if (when.getTime() <= now.getTime()) {
    when.setDate(when.getDate() + 1);
    label = "내일";
  }
  return { when, label, inMs: when.getTime() - now.getTime() };
}

function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}시간 ${m}분` : `${m}분`;
}

export default function SettingsPanel({
  settings,
  onChange,
  onApply,
  collecting,
  collectStatus,
  saveWarn
}: {
  settings: AppSettings;
  onChange: (next: AppSettings) => void;
  onApply: () => void;
  collecting: boolean;
  collectStatus: { ok: boolean; msg: string } | null;
  saveWarn: boolean;
}) {
  const { criteria, dailyCollectAt, lastCollectedAt, lastCollectSource } = settings;
  const sourceLabel: Record<string, string> = {
    inbox: "사람인(inbox)",
    "fetch-saramin": "사람인(API)",
    rescore: "재채점만"
  };
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 60000);
    return () => window.clearInterval(id);
  }, []);

  const setWeight = (k: AxisKey, v: number) =>
    onChange({ ...settings, criteria: { ...criteria, weights: { ...criteria.weights, [k]: v } } });

  const setThreshold = (k: "A" | "B" | "C", v: number) =>
    onChange({
      ...settings,
      criteria: { ...criteria, thresholds: { ...criteria.thresholds, [k]: v } }
    });

  const setHardFilter = (k: HardFilterKey, v: boolean) =>
    onChange({
      ...settings,
      criteria: { ...criteria, hardFilters: { ...criteria.hardFilters, [k]: v } }
    });

  const reset = () => onChange({ ...settings, criteria: DEFAULT_SETTINGS.criteria });

  const th = criteria.thresholds;
  const thresholdWarn = !(th.A > th.B && th.B > th.C);
  const run = nextRun(dailyCollectAt);
  const wsum = AXES.reduce((s, a) => s + (criteria.weights[a.key] || 0), 0);

  return (
    <details className="settings">
      <summary>
        <span>평가 기준 · 일일 취합</span>
        <span className="settings__preview">
          가중치 {AXES.map((a) => criteria.weights[a.key]).join(":")} · 필터{" "}
          {HARD_FILTERS.filter((f) => criteria.hardFilters[f.key]).length}/{HARD_FILTERS.length} · 취합{" "}
          {dailyCollectAt}
          {saveWarn && <b className="settings__warn"> · 저장 실패(로컬만)</b>}
        </span>
      </summary>

      <div className="settings__body">
        {/* ── 평가 기준 ── */}
        <section className="settings__sec">
          <div className="settings__sec-head">
            <h3>평가 기준</h3>
            <button className="btn-ghost" onClick={reset}>
              기본값 복원
            </button>
          </div>

          <div className="settings__grid">
            {AXES.map((a) => {
              const v = criteria.weights[a.key] ?? 0;
              const pct = wsum > 0 ? Math.round((v / wsum) * 100) : 0;
              return (
                <div className="wrow" key={a.key}>
                  <div className="wrow__label">
                    {a.label}
                    <span className="wrow__hint">{a.hint}</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={4}
                    step={0.5}
                    value={v}
                    onChange={(e) => setWeight(a.key, Number(e.target.value))}
                    aria-label={`${a.label} 가중치`}
                  />
                  <div className="wrow__val">
                    ×{v}
                    <span className="wrow__pct">{pct}%</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="settings__filters">
            <span className="section-label">공통 조건 (하드 필터 — 끄면 제외 공고가 목록에 다시 포함)</span>
            <div className="settings__filters-row">
              {HARD_FILTERS.map((f) => (
                <label className="cfield" key={f.key}>
                  <input
                    type="checkbox"
                    checked={criteria.hardFilters[f.key]}
                    onChange={(e) => setHardFilter(f.key, e.target.checked)}
                  />
                  <span>{f.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="settings__thresholds">
            <span className="section-label">등급 컷 (점수 0~100)</span>
            {(["A", "B", "C"] as const).map((g) => (
              <label className="tfield" key={g}>
                <span className={`grade grade--${g}`}>{g}</span>
                <span>≥</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={th[g]}
                  onChange={(e) => setThreshold(g, Number(e.target.value))}
                />
              </label>
            ))}
            <span className="tfield__d">
              <span className="grade grade--D">D</span>
              <span>그 외</span>
            </span>
          </div>
          {thresholdWarn && (
            <p className="settings__note settings__note--warn">
              컷은 A &gt; B &gt; C 순서를 권장합니다. 현재 값은 일부 등급이 나오지 않을 수 있습니다.
            </p>
          )}
          <p className="settings__note">
            슬라이더·컷·필터를 바꾸면 화면은 <b>즉시 미리보기</b>로 다시 계산됩니다(저장은 자동).
            아래 <b>적용</b>을 누르면 그 기준으로 사람인에서 다시 취합해 <code>ranked-jobs.json</code>{" "}
            을 갱신합니다.
          </p>

          <div className="settings__apply">
            <button className="btn-primary" onClick={onApply} disabled={collecting}>
              {collecting ? "취합 중…" : "적용 · 사람인 재취합"}
            </button>
            {collectStatus && (
              <span className={`settings__status${collectStatus.ok ? "" : " settings__status--err"}`}>
                {collectStatus.msg}
              </span>
            )}
          </div>
        </section>

        {/* ── 일일 취합 시간 ── */}
        <section className="settings__sec">
          <div className="settings__sec-head">
            <h3>일일 취합 시간</h3>
          </div>
          <div className="settings__collect">
            <label className="tfield">
              <span>매일</span>
              <input
                type="time"
                value={dailyCollectAt}
                onChange={(e) => onChange({ ...settings, dailyCollectAt: e.target.value })}
              />
              <span>에 취합</span>
            </label>
            <span className="settings__next">
              다음 취합: {run.label} {dailyCollectAt} · <b>{fmtDuration(run.inMs)}</b> 후
            </span>
          </div>
          <p className="settings__note">
            마지막 취합:{" "}
            {lastCollectedAt ? new Date(lastCollectedAt).toLocaleString("ko-KR") : "기록 없음"}
            {lastCollectSource && ` · ${sourceLabel[lastCollectSource] ?? lastCollectSource}`}
          </p>
          <p className="settings__note">
            이 시각은 <code>data/settings.json</code> 에 저장됩니다. 실제 자동 실행은{" "}
            <code>npm run collect</code>(= <code>scripts/collect.mjs</code>)을 OS 스케줄러(Windows
            작업 스케줄러 / cron)에 이 시각으로 등록하세요. 스크립트가 <code>ranked-jobs.json</code>{" "}
            을 갱신하고 <code>lastCollectedAt</code> 을 기록합니다.
          </p>
        </section>
      </div>
    </details>
  );
}
