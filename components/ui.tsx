"use client";

import { APPLY_STATUSES, type ApplyStatus, type Grade } from "@/lib/types";

export function GradeBadge({ grade }: { grade: Grade }) {
  return (
    <span className={`grade grade--${grade}`} title={`등급 ${grade}`}>
      {grade}
    </span>
  );
}

export function ScoreBar({ score, grade }: { score: number; grade: Grade }) {
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="score">
      <span className="score__num">{score}</span>
      <div className={`bar${grade === "D" ? " bar--dim" : ""}`}>
        <div className="bar__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function StatusSelect({
  value,
  onChange
}: {
  value: ApplyStatus;
  onChange: (next: ApplyStatus) => void;
}) {
  return (
    <select
      className="status"
      data-status={value}
      value={value}
      onChange={(e) => onChange(e.target.value as ApplyStatus)}
      aria-label="지원상태"
    >
      {APPLY_STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
