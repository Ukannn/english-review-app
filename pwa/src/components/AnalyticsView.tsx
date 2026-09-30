import { BarChart3, RefreshCw } from "lucide-react";
import { useState } from "react";
import type { DashboardData, PhraseSummary } from "../lib/contracts";
import { reportDays, rate, type ExpressionLayer } from "../lib/learningMetrics";
import { AccuracyChart, DueChart, ExpressionColumn } from "./ReportCharts";
import { PageHeading } from "./PageHeading";

export function AnalyticsView({ dashboard, inventory = null, inventoryLoading = false, inventoryError = "", loading, onRefresh, onRecords = () => { location.hash = "history"; } }: {
  dashboard: DashboardData | null; inventory?: PhraseSummary[] | null; inventoryLoading?: boolean; inventoryError?: string; loading: boolean; onRefresh(): Promise<void>; onRecords(filter?: { date?: string; layer?: ExpressionLayer }): void;
}) {
  const [showDaily, setShowDaily] = useState(false);
  if (!dashboard) return <div className="loading-card card"><BarChart3/><p>{loading ? "正在准备学习报告…" : "学习报告暂时无法读取。"}</p><button className="secondary-button" disabled={loading} onClick={() => void onRefresh()}>重新加载</button></div>;
  const { days, version, v3 } = reportDays(dashboard);
  const attempts = days.reduce((n, d) => n + d.independentAttempts, 0), success = days.reduce((n, d) => n + d.independentSuccess, 0);
  const expressions = days.reduce((n, d) => n + d.expressionAttempts, 0), expressionSuccess = days.reduce((n, d) => n + d.expressionSuccess, 0);
  const observed = days.filter(d => d.independentAttempts || d.expressionAttempts);
  const sumTime = days.reduce((n, d) => n + (d.durationMinutes ?? 0), 0);
  return <section className="page-stack report-page view-enter">
    <PageHeading eyebrow="先看变化，再看原因" title="学习报告" description="从正确率、表达积累和复习安排，看自己的学习节奏。" action={<button className="icon-button" aria-label="刷新学习报告" disabled={loading || inventoryLoading} onClick={() => void onRefresh()}><RefreshCw size={19} className={loading || inventoryLoading ? "spin" : ""}/></button>}/>
    {inventoryError && <div className="notice notice--red" role="alert"><span>{inventoryError} {inventory ? "仍显示上次成功读取的表达快照。" : "表达分层与未来安排尚未读取成功。"}</span><button className="text-button" onClick={() => void onRefresh()}>重试</button></div>}
    <div className="report-hero-grid">
      <article className="card report-chart-card report-accuracy"><div className="section-title"><div><h2>正确率怎么变化</h2><p>近 14 天 · 两种练习分别看</p></div></div><div className="accuracy-summary"><div><strong>{rate(success, attempts)}</strong><span>独立提取 · {success}/{attempts} 次</span></div><div><strong>{rate(expressionSuccess, expressions)}</strong><span>{v3 ? "读后表达" : "情境表达"} · {expressionSuccess}/{expressions} 次</span></div></div><AccuracyChart days={days} expressionLabel={v3 ? "读后表达" : "情境表达"} onRecords={date => onRecords({ date })}/><details className="metric-definition"><summary>正确率怎么算</summary><p>{v3 ? "独立提取：完整目标答对且未使用提示的次数 ÷ 符合独立提取条件的尝试次数；提示后完成仍计入分母。初学、填空及目标未测到的合理别答不混入这项统计。读后表达：意思成立且没有明显自然度问题的次数 ÷ 表达尝试次数。" : "按当前评分版本返回的独立提取和情境表达分子、分母分别计算；不与旧规则结果混算。"}</p></details></article>
      <article className="card report-chart-card"><div className="section-title"><div><h2>表达积累到哪一步</h2><p>整根柱子 = 已收录表达</p></div></div>{inventory ? <ExpressionColumn items={inventory} onRecords={layer => onRecords({ layer })}/> : <p className="empty-inline" role="status">{inventoryLoading ? "正在读取全部表达…" : "表达统计尚未读取。"}</p>}</article>
    </div>
    <article className="card report-chart-card"><div className="section-title"><div><h2>接下来要复习多少</h2><p>按当前已安排的到期日期，提前留出一点时间。</p></div></div>{inventory ? <DueChart items={inventory} today={dashboard.learningDate}/> : <p className="empty-inline" role="status">{inventoryLoading ? "正在读取完整复习安排…" : "暂时没有可读取的安排快照。"}</p>}</article>
    <section className="report-observations" aria-label="长期观察与下一步"><div><span className="eyebrow">图表之后</span><h2>隔几天后，还能独立想起吗？</h2><p>{observed.length < 3 ? `当前版本有 ${observed.length} 个日期的可比较记录，还不足以判断稳定变化。` : `当前版本有 ${observed.length} 个日期的结果，可以观察变化；每个日期的次数不同，不能只看百分比。`}现有记录不能完整核实期间是否重看，暂不作长期掌握判断。</p><button className="text-button" onClick={() => onRecords()}>查阅已保存的练习原答</button></div><div><h2>哪些问题反复出现？</h2><p>到表达记录中核对不同日期的原答、参考与兼容判定。需要同时查看做对的记录，才判断是否反复需要巩固。</p><button className="text-button" onClick={() => onRecords({ layer: "consolidating" })}>查看巩固中表达的证据</button></div><div><h2>下一阶段先关注一件事</h2><p>下次遇到巩固中的表达，先尝试完整回忆，再按需看提示。建议由你选择，不会自动增加题量或改变复习安排。</p></div></section>
    <section className="report-coverage"><div><h2>这份报告覆盖什么</h2><p>近 14 天 · {version} · 上海学习日期。{observed.length} 个活跃日期，{days.some(d => d.durationMinutes !== null) ? `已记录 ${Math.round(sumTime)} 分钟` : "用时尚无记录"}。{v3 && `累计完整学习 ${dashboard.v3!.completedLessons} 次。`}等待批改的结果不计入最终正确率。</p><p>更早记录仍然保留；不同评分版本不合并成一条正确率曲线。表达历史提供原始证据，完整会话目录尚需只读接口。</p></div><button className="secondary-button" aria-expanded={showDaily} onClick={() => setShowDaily(v => !v)}>{showDaily ? "收起每日数字" : "查看每日数字"}</button></section>
    {showDaily && <div className="table-scroll card" tabIndex={0} aria-label="每日正确率原始数字，可横向滚动"><table><thead><tr><th>学习日期</th><th>独立提取</th><th>{v3 ? "读后表达" : "情境表达"}</th><th>用时</th><th>证据</th></tr></thead><tbody>{days.map(d => <tr key={d.date}><td>{d.date}</td><td>{d.independentAttempts ? `${rate(d.independentSuccess, d.independentAttempts)} · ${d.independentSuccess}/${d.independentAttempts}` : "暂无记录"}</td><td>{d.expressionAttempts ? `${rate(d.expressionSuccess, d.expressionAttempts)} · ${d.expressionSuccess}/${d.expressionAttempts}` : "暂无记录"}</td><td>{d.durationMinutes === null ? "未记录" : `${d.durationMinutes} 分钟`}</td><td><button className="text-button" onClick={() => onRecords({ date: d.date })}>表达历史</button></td></tr>)}</tbody></table></div>}
  </section>;
}
