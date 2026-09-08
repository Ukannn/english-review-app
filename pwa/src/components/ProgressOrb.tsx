import type { CSSProperties } from "react";
export function ProgressOrb({ value, total }: { value: number; total: number }) {
  const angle = Math.round(Math.max(0, Math.min(1, value / Math.max(1, total))) * 360);
  return <div className="progress-orb" aria-label={`今日学习进度 ${value}/${total}`}><div className="progress-orb__ring" style={{ "--progress-angle": `${angle}deg` } as CSSProperties}><div className="progress-orb__center"><strong>{value}</strong><span>/ {total}</span></div></div><span className="progress-orb__label">今日学习进度</span></div>;
}
