import { BarChart3, Clock3, Layers, RefreshCw, Target, MessageCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { DashboardData, LearningAnalytics } from "../lib/contracts";
import { PageHeading } from "./PageHeading";

const ratio = (success: number, attempts: number) => attempts ? `${Math.round(success / attempts * 100)}%` : "暂无记录";
export function AnalyticsView({ dashboard, loading, onRefresh }: { dashboard: DashboardData | null; loading: boolean; onRefresh(): Promise<void> }) {
  if (!dashboard) return <div className="loading-card card"><BarChart3/><p>{loading ? "正在准备学习报告…" : "学习报告暂时无法读取。"}</p><button className="secondary-button" disabled={loading} onClick={() => void onRefresh()}>重新加载</button></div>;
  const days = [...(dashboard.analytics?.days ?? [])].sort((a,b) => a.date.localeCompare(b.date));
  const sum = (key: "durationMinutes" | "independentSuccess" | "independentAttempts" | "expressionSuccess" | "expressionAttempts") => days.reduce((total,day) => total+(day[key]??0),0);
  const attempts = sum("independentAttempts"), expressions = sum("expressionAttempts");
  return <section className="page-stack view-enter">
    <PageHeading eyebrow="学习的节奏与积累" title="学习报告" description="回看已经完成的练习，找到下一步想巩固的表达。" action={<button className="icon-button" aria-label="刷新学习报告" disabled={loading} onClick={() => void onRefresh()}><RefreshCw size={19} className={loading ? "spin" : ""}/></button>}/>
    <div className="metric-grid">
      <Metric icon={<Target/>} label="无提示目标提取" value={ratio(sum("independentSuccess"),attempts)} note={`${attempts} 次提取记录`}/>
      <Metric icon={<MessageCircle/>} label="情境表达成功" value={ratio(sum("expressionSuccess"),expressions)} note={`${expressions} 次表达记录`}/>
      <Metric icon={<Clock3/>} label="近 14 天练习用时" value={days.some(day=>day.durationMinutes!==null) ? `${Math.round(sum("durationMinutes"))} 分钟` : "暂无记录"} note="来自已记录的练习"/>
      <Metric icon={<Layers/>} label="当前待复习" value={days.at(-1)?.backlog == null ? "暂无记录" : `${days.at(-1)!.backlog} 项`} note={`资料库共 ${dashboard.totals.phrases} 个表达`}/>
    </div>
    <article className="card chart-card"><div className="section-title chart-heading"><div><span>近 14 天的学习表现</span><p>分别看目标提取和情境表达，未练习的日期留空。</p></div><div className="trend-legend"><span><i className="legend-line"/>目标提取</span><span><i className="legend-line legend-line--red"/>情境表达</span></div></div>
      {days.some(day=>day.independentAttempts||day.expressionAttempts) ? <LearningTrend days={days}/> : <div className="empty-inline"><BarChart3 size={30}/><p>完成练习后，这里会逐渐呈现你的学习轨迹。</p></div>}
    </article>
    {days.length>0 && <article className="card chart-card"><div className="section-title"><div><span>每日记录</span><p>百分比旁的次数，帮助你判断练习量是否足够。</p></div></div><div className="table-scroll" tabIndex={0} aria-label="每日学习记录，可横向滚动"><table><thead><tr><th>日期</th><th>用时</th><th>无提示提取</th><th>情境表达</th><th>待复习</th></tr></thead><tbody>{days.map(day=><tr key={day.date}><td>{day.date}</td><td>{day.durationMinutes===null?"—":`${Math.round(day.durationMinutes)} 分钟`}</td><td>{ratio(day.independentSuccess,day.independentAttempts)}{day.independentAttempts>0&&` · ${day.independentSuccess}/${day.independentAttempts}`}</td><td>{ratio(day.expressionSuccess,day.expressionAttempts)}{day.expressionAttempts>0&&` · ${day.expressionSuccess}/${day.expressionAttempts}`}</td><td>{day.backlog??"—"}</td></tr>)}</tbody></table></div></article>}
    <p className="history-note">旧系统保留 {dashboard.analytics?.legacyReviews ?? dashboard.totals.reviews} 次历史复习，单独留存，不计入以上新规则表现。文字练习不代表口语或发音水平。</p>
  </section>;
}
function Metric({ icon, label, value, note }: { icon: ReactNode; label: string; value: string; note: string }) {
  return <article className="metric-card card"><div className="metric-icon">{icon}</div><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}
function LearningTrend({ days }: { days: LearningAnalytics["days"] }) {
  const width = Math.max(640, days.length*58), height = 240, x = (i:number) => 44+i*(width-88)/Math.max(1,days.length-1), y = (rate:number) => 196-rate*154;
  const series = [{name:"目标提取",success:"independentSuccess",attempts:"independentAttempts",red:false},{name:"情境表达",success:"expressionSuccess",attempts:"expressionAttempts",red:true}] as const;
  return <div className="trend-scroll" tabIndex={0} aria-label="学习趋势，可横向滚动"><div className="trend-chart" style={{width}}><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="近 14 天目标提取与情境表达成功率；完整数字见每日记录">
    {[0,.5,1].map(rate=><g key={rate}><line className="trend-gridline" x1={44} x2={width-44} y1={y(rate)} y2={y(rate)}/><text className="trend-axis-label" x={36} y={y(rate)+4} textAnchor="end">{rate*100}%</text></g>)}
    {series.map(s=><g key={s.name} className={s.red ? "trend-series--red" : ""}>{days.map((day,i)=>{if(!day[s.attempts])return null;const rate=day[s.success]/day[s.attempts],prior=days[i-1];return <g key={day.date}>{prior?.[s.attempts]>0&&<line className="trend-line" x1={x(i-1)} y1={y(prior[s.success]/prior[s.attempts])} x2={x(i)} y2={y(rate)}/>}<circle className="trend-point" cx={x(i)} cy={y(rate)} r={4}><title>{`${day.date} ${s.name} ${ratio(day[s.success],day[s.attempts])}`}</title></circle></g>;})}</g>)}
    {days.map((day,i)=><text key={day.date} className="trend-axis-label" x={x(i)} y={222} textAnchor="middle">{day.date.slice(5)}</text>)}
  </svg></div></div>;
}
