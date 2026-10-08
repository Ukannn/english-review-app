import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SegmentedControl } from "./SegmentedControl";
import type { LearningAnalytics, PhraseSummary } from "../lib/contracts";
import { dueSchedule, expressionLayer, expressionLayers, rate, type ExpressionLayer } from "../lib/learningMetrics";
import { formatLearningDate } from "../lib/learningDate";

export function AccuracyChart({ days, onRecords, expressionLabel = "情境表达" }: { days: Array<Omit<LearningAnalytics["days"][number], "backlog">>; onRecords(date: string): void; expressionLabel?: string }) {
  const [selected, setSelected] = useState<string | null>(null);
  const plot = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(650);
  useLayoutEffect(() => {
    if (!plot.current) return;
    const measure = () => { const measured = plot.current?.clientWidth; if (measured) setWidth(measured); };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(plot.current);
    return () => observer?.disconnect();
  }, [days]);
  const series = [{ key: "independent", label: "独立提取", success: "independentSuccess", attempts: "independentAttempts" }, { key: "expression", label: expressionLabel, success: "expressionSuccess", attempts: "expressionAttempts" }] as const;
  const x = (i: number) => 45 + i * (width - 71) / Math.max(1, days.length - 1), y = (value: number) => 190 - value * 160;
  const dateTicks: number[] = [];
  for (let i = days.length - 1; i >= 0; i--) {
    if ((i === days.length - 1 || i % 3 === 0) && (dateTicks.length === 0 || x(dateTicks.at(-1)!) - x(i) >= 54)) dateTicks.push(i);
  }
  const observed = days.filter(d => d.independentAttempts || d.expressionAttempts);
  const detail = days.find(d => d.date === selected) ?? observed.at(-1);
  return <div className="accuracy-chart">
    <div className="chart-key"><span><i/>独立提取</span><span><i className="chart-key--expression"/>{expressionLabel}</span></div>
    {observed.length ? <>
      <div className="accuracy-scroll" aria-label="正确率图，数据点可选择">
        <div className="accuracy-plot" ref={plot}><svg viewBox={`0 0 ${width} 225`} role="img" aria-label="近14天正确率；没有记录的日期不画数据点">
          {[0, .5, 1].map(r => <g key={r}><line className="trend-gridline" x1={45} x2={width - 20} y1={y(r)} y2={y(r)}/><text className="trend-axis-label" x={36} y={y(r) + 4} textAnchor="end">{r * 100}%</text></g>)}
          {series.map(s => <g key={s.key} className={`accuracy-series accuracy-series--${s.key}`}>{days.map((d, i) => {
            if (!d[s.attempts]) return null;
            const prior = days[i - 1];
            return <g key={d.date}>{prior?.[s.attempts] > 0 && <line className="trend-line" x1={x(i - 1)} y1={y(prior[s.success] / prior[s.attempts])} x2={x(i)} y2={y(d[s.success] / d[s.attempts])}/>}<circle className="trend-point" cx={x(i)} cy={y(d[s.success] / d[s.attempts])} r={4}/></g>;
          })}</g>)}
          {dateTicks.map(i => <text key={days[i].date} className="trend-axis-label" x={x(i)} y={216} textAnchor="middle">{days[i].date.slice(5)}</text>)}
        </svg>
        {series.flatMap(s => days.map((d, i) => d[s.attempts] ? <button key={`${s.key}:${d.date}`} className="chart-point-control" style={{ left: `${x(i) / width * 100}%`, top: `${y(d[s.success] / d[s.attempts]) / 225 * 100}%` }} aria-label={`${formatLearningDate(d.date)} ${s.label} ${rate(d[s.success], d[s.attempts])}，${d[s.success]}/${d[s.attempts]} 次`} onMouseEnter={() => setSelected(d.date)} onFocus={() => setSelected(d.date)} onClick={() => setSelected(d.date)}/> : null))}
        </div>
      </div>
      {detail && <div className="chart-readout" aria-live="polite"><time>{detail.date.slice(5)}</time><span>独立提取 <b>{rate(detail.independentSuccess, detail.independentAttempts)}</b> · {detail.independentSuccess}/{detail.independentAttempts}</span><span>{expressionLabel} <b>{rate(detail.expressionSuccess, detail.expressionAttempts)}</b> · {detail.expressionSuccess}/{detail.expressionAttempts}</span><button className="text-button" onClick={() => onRecords(detail.date)}>查阅当天表达历史</button></div>}
      <p className="chart-note">{observed.length} 个有记录的日期；空白不代表 0%。{observed.length < 3 && "目前只能看这几次结果，尚不能判断稳定趋势。"}</p>
    </> : <p className="empty-inline">完成练习后显示真实数据点。当前没有可比较的正确率记录。</p>}
  </div>;
}

export function ExpressionColumn({ items, onRecords }: { items: PhraseSummary[]; onRecords(layer?: ExpressionLayer): void }) {
  const eligible = items.filter(p => ["active", "mastered"].includes(p.status));
  const counts = { unlearned: 0, consolidating: 0, longInterval: 0 };
  eligible.forEach(p => counts[expressionLayer(p)]++);
  const [hovered, setHovered] = useState<ExpressionLayer | null>(null);
  const [pinned, setPinned] = useState<ExpressionLayer | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const selected = pinned ?? hovered;
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) { setPinned(null); setHovered(null); } };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setPinned(null); setHovered(null); } };
    document.addEventListener("pointerdown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, []);
  if (!eligible.length) return <p className="empty-inline">还没有已收录表达，分层柱暂不显示。</p>;
  const current = expressionLayers.find(l => l.key === selected);
  return <div className="expression-distribution" ref={root}>
    <div className="distribution-total"><strong>{eligible.length}</strong><span>个已收录表达</span></div>
    <div className="distribution-body">
      <div className="expression-column" aria-label="一根分层柱，整根代表全部已收录表达">
        {expressionLayers.filter(l => counts[l.key] > 0).map(l => <button key={l.key} className={`expression-segment expression-segment--${l.key} ${selected === l.key ? "is-selected" : ""}`} style={{ flexGrow: counts[l.key] }} aria-label={`${l.label} ${counts[l.key]} 个，占 ${rate(counts[l.key], eligible.length)}`} aria-pressed={pinned === l.key} onPointerEnter={event => { if (event.pointerType !== "touch") setHovered(l.key); }} onPointerLeave={() => setHovered(null)} onFocus={() => setHovered(l.key)} onBlur={() => setHovered(null)} onClick={() => setPinned(value => value === l.key ? null : l.key)}><span aria-hidden="true">{counts[l.key]}</span></button>)}
      </div>
      <div className="distribution-legend">{expressionLayers.map(l => <button key={l.key} className={selected === l.key ? "is-selected" : ""} aria-pressed={pinned === l.key} onClick={() => setPinned(value => value === l.key ? null : l.key)} onFocus={() => setHovered(l.key)} onBlur={() => setHovered(null)}><i className={`distribution-dot distribution-dot--${l.key}`}/><span>{l.label}<small>{counts[l.key]} 个</small></span></button>)}</div>
    </div>
    {current ? <div className="distribution-detail" role="status"><strong>{current.label} · {rate(counts[current.key], eligible.length)}</strong><span>{counts[current.key]} / {eligible.length} 个</span><p>{current.note}</p><button className="text-button" onClick={() => onRecords(current.key)}>查看这些表达</button></div> : <p className="chart-note">悬停或点选色段，查看占比与分层依据。按复习阶段分层，未使用旧掌握标记判断能力。</p>}
  </div>;
}

export function DueChart({ items, today }: { items: PhraseSummary[]; today: string }) {
  const [range, setRange] = useState<7 | 30>(7);
  const [selected, setSelected] = useState<string | null>(null);
  const schedule = dueSchedule(items, today, range);
  const maximum = Math.max(1, ...schedule.days.map(d => d.count));
  const detail = schedule.days.find(d => d.date === selected);
  return <>
    <div className="due-summary"><div><strong>{schedule.total}</strong><span>项在未来 {range} 天到期</span></div><SegmentedControl label="未来复习量范围">{([7, 30] as const).map(n => <button key={n} aria-pressed={range === n} className={range === n ? "is-active" : ""} onClick={() => { setRange(n); setSelected(null); }}>{n} 天</button>)}</SegmentedControl></div>
    <div className="due-scroll" tabIndex={0} aria-label={`未来${range}天的每日到期量，可横向滚动`}><div className={`due-bars due-bars--${range}`}>
      {schedule.days.map(d => <button className={selected === d.date ? "is-selected" : ""} key={d.date} aria-label={`${formatLearningDate(d.date)} 到期 ${d.count} 项`} onMouseEnter={() => setSelected(d.date)} onFocus={() => setSelected(d.date)} onClick={() => setSelected(d.date)}><span className="due-bar-track"><span className="due-bar" style={{ height: `${d.count / maximum * 100}%` }}/><b>{d.count}</b></span><time>{d.date.slice(5)}</time></button>)}
    </div></div>
    <p className="chart-note" aria-live="polite">{detail ? `${formatLearningDate(detail.date)}：当前安排 ${detail.count} 项。` : "点选日期查看每日数量。"}已有到期库存 {schedule.backlog} 项单独保留，不计入未来数量。{schedule.unscheduled > 0 && `另有 ${schedule.unscheduled} 项尚无日期。`}</p>
    <p className="chart-note">截至 {today} 的现有安排，供你规划；真实作答后可能改变，不包含尚未安排的新学习。</p>
  </>;
}
