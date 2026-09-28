import { BarChart3, Clock3, Layers, RefreshCw, Target, MessageCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { DashboardData, LearningAnalytics, LessonAnalytics } from "../lib/contracts";
import { PageHeading } from "./PageHeading";

const ratio = (success: number, attempts: number) => attempts ? `${Math.round(success / attempts * 100)}%` : "暂无记录";
export function AnalyticsView({ dashboard, loading, onRefresh }: { dashboard: DashboardData | null; loading: boolean; onRefresh(): Promise<void> }) {
  if (!dashboard) return <div className="loading-card card"><BarChart3/><p>{loading ? "正在准备学习报告…" : "学习报告暂时无法读取。"}</p><button className="secondary-button" disabled={loading} onClick={() => void onRefresh()}>重新加载</button></div>;
  if(dashboard.v3 && (dashboard.v3.completedLessons>0 || dashboard.v3.days.some(day=>day.attempts>0))) return <LessonReport data={dashboard.v3} onRefresh={onRefresh}/>;
  const days = [...(dashboard.analytics?.days ?? [])].sort((a,b) => a.date.localeCompare(b.date));
  const sum = (key: "durationMinutes" | "independentSuccess" | "independentAttempts" | "expressionSuccess" | "expressionAttempts") => days.reduce((total,day) => total+(day[key]??0),0);
  const attempts = sum("independentAttempts"), expressions = sum("expressionAttempts");
  return <section className="page-stack view-enter">
    <PageHeading eyebrow="学习的节奏与积累" title="学习报告" description="回看已经完成的练习，找到下一步想巩固的表达。" action={<button className="icon-button" aria-label="刷新学习报告" disabled={loading} onClick={() => void onRefresh()}><RefreshCw size={19} className={loading ? "spin" : ""}/></button>}/>
    <div className="metric-grid">
      <Metric icon={<Target/>} label="无提示目标提取" value={ratio(sum("independentSuccess"),attempts)} note={`${attempts} 次提取记录`}/>
      <Metric icon={<MessageCircle/>} label="情境表达成功" value={ratio(sum("expressionSuccess"),expressions)} note={`${expressions} 次表达记录`}/>
      <Metric icon={<Clock3/>} label="近 14 天练习用时" value={days.some(day=>day.durationMinutes!==null) ? `${Math.round(sum("durationMinutes"))} 分钟` : "暂无记录"} note="来自已记录的练习"/>
      <Metric icon={<Layers/>} label="当前待复习" value={dashboard.v3 ? `${dashboard.v3.dueCount} 项` : days.at(-1)?.backlog == null ? "暂无记录" : `${days.at(-1)!.backlog} 项`} note={`资料库共 ${dashboard.totals.phrases} 个表达`}/>
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

function LessonReport({data,onRefresh}:{data:LessonAnalytics;onRefresh():Promise<void>}) {
 const sum=(key:keyof LessonAnalytics["days"][number])=>data.days.reduce((n,d)=>n+(typeof d[key]==="number"?d[key] as number:0),0);
 const enough=sum("delayedAttempts")>=20&&sum("expressionAttempts")>=10;
 return <section className="page-stack"><PageHeading eyebrow="学习证据" title="理解、提取与表达" description="不同练习分开看；读后成功不等于独立记住。" action={<button onClick={()=>void onRefresh()}>刷新</button>}/>
 <div className="metric-grid"><Metric icon={<Target/>} label="完整独立提取" value={ratio(sum("independentSuccess"),sum("independentAttempts"))} note={`${sum("independentSuccess")}/${sum("independentAttempts")}，提示后完成也计入分母`}/><Metric icon={<MessageCircle/>} label="读后表达成功" value={ratio(sum("expressionSuccess"),sum("expressionAttempts"))} note={`${sum("expressionSuccess")}/${sum("expressionAttempts")} 次读后回应`}/><Metric icon={<Clock3/>} label="有效学习时间" value={`${Math.round(sum("durationMinutes"))} 分钟`} note="近 14 天；排除后台、等待与长时间无交互"/><Metric icon={<Layers/>} label="到期表达" value={`${data.dueCount} 项`} note="包含 active 与 mastered；未练项保留到期日期"/></div>
 <article className="card"><h2>还有哪些证据？</h2><p>使用提示：{sum("hinted")}/{sum("attempts")} 次尝试。局部填空正确：{sum("gapSuccess")}/{sum("gapAttempts")}。</p><p>阅读后的跨日独立提取：{sum("delayedSuccess")}/{sum("delayedAttempts")}。合理替代表达、目标未测到：{sum("unmeasured")} 次。</p><p>尚无尝试的日期不算失败；旧版计时和成绩单独保留，不与这里直接混算。文字表现不代表口语或发音。</p></article>
 {data.completedLessons>=10?<details className="card"><summary>回顾这 10 次以上的完整学习</summary><p>{enough?"已有可供观察的记录，请结合下列用时与负担决定是否调整。":"延迟提取或表达样本仍不足，暂不判断哪种形式更有效。"}</p><p>延迟提取 {sum("delayedSuccess")}/{sum("delayedAttempts")}；读后表达 {sum("expressionSuccess")}/{sum("expressionAttempts")}；有效用时 {Math.round(sum("durationMinutes"))} 分钟。</p><p>已记录的负担：轻松 {data.burden.filter(b=>b.value==="light").length} 次，合适 {data.burden.filter(b=>b.value==="right").length} 次，偏重 {data.burden.filter(b=>b.value==="heavy").length} 次。未反馈保持未知。系统不会据此自动修改规则。</p></details>:<p className="muted">已完整完成 {data.completedLessons}/10 次；达到 10 次后提供复盘入口。</p>}
 <article className="card table-scroll"><table><thead><tr><th>日期</th><th>独立提取</th><th>读后表达</th><th>有效分钟</th></tr></thead><tbody>{data.days.map(d=><tr key={d.date}><td>{d.date}</td><td>{d.independentAttempts?`${d.independentSuccess}/${d.independentAttempts}`:"—"}</td><td>{d.expressionAttempts?`${d.expressionSuccess}/${d.expressionAttempts}`:"—"}</td><td>{d.durationMinutes??"—"}</td></tr>)}</tbody></table></article>
 </section>;
}
