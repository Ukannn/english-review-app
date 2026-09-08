import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthGate } from "./components/AuthGate";
import { AiHandoff } from "./components/AiHandoff";
import { AiJobPanel } from "./components/AiJobPanel";
import { ReviewView } from "./components/ReviewView";
import { SettingsView } from "./components/SettingsView";
import { PhraseView, ContextView, CandidateView } from "./components/LibraryViews";
import { api, supabase } from "./lib/api";
import type { ApiClient, DashboardData, ReviewBootstrap } from "./lib/contracts";
import { demoApi } from "./lib/demoApi";
import { clearAllRecovery } from "./lib/recovery";

type View = "home" | "review" | "grading" | "questions" | "phrases" | "context" | "candidates" | "settings";
export function App() {
  const demo = import.meta.env.VITE_DEMO_MODE === "true";
  const client = useMemo(() => demo ? demoApi : api, [demo]);
  return <AuthGate demo={demo}><LearningApp client={client} demo={demo} /></AuthGate>;
}

// This component only mounts after authentication. Account changes unmount all learning state.
export function LearningApp({ client, demo }: { client: ApiClient; demo: boolean }) {
  const [view, setView] = useState<View>("home");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [bootstrap, setBootstrap] = useState<ReviewBootstrap | null>(null);
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      // Opening the app repairs a missed daily queue before reporting today's totals.
      setBootstrap(await client.getReviewBootstrap());
      setDashboard(await client.getDashboard());
    }
    catch (caught) { setError(caught instanceof Error ? caught.message : "内容加载失败，请重试。"); }
    finally { setLoading(false); }
  }, [client]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function startReview() {
    setError(null);
    try {
      const next = await client.getReviewBootstrap(); setBootstrap(next);
      if (next.session?.submissionId) { setSubmissionId(next.session.submissionId); setView("grading"); }
      else if (next.state === "open" && next.questions.length) setView("review");
      else if (next.state === "questions_required") setView("questions");
      else setError("今天没有到期内容。可以添加真实语料、确认候选，或查看题量设置。");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "无法打开今日学习。"); }
  }
  async function signOut() {
    try {
      const result = await supabase?.auth.signOut();
      if (result?.error) throw result.error;
      await clearAllRecovery();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "退出失败，请重试。"); }
  }
  if (view === "review" && bootstrap?.session) return <ReviewView api={client} bootstrap={bootstrap} onClose={() => {setView("home"); void refresh();}} onSubmitted={id => {setSubmissionId(id);setView("grading");void refresh();}} />;
  if (view === "grading" && submissionId) return <AiHandoff api={client} submissionId={submissionId} onDone={() => {setView("home");void refresh();}} onClose={() => setView("home")} />;
  const nav: Array<{target: View; label: string}> = [{target:"home",label:"今天"},{target:"phrases",label:"我的搭配"},{target:"context",label:"语料"},{target:"candidates",label:"候选"},{target:"settings",label:"设置"}];
  return <div className="app-shell"><aside className="sidebar"><button className="wordmark" onClick={() => setView("home")}><span className="brand-mark small">E</span><span><strong>English Lab</strong><small>Everyday English</small></span></button><nav className="sidebar-nav" aria-label="主导航">{nav.map((item,index) => <button key={item.target} className={view === item.target ? "active" : ""} onClick={() => setView(item.target)}><span className="nav-icon">0{index+1}</span><strong>{item.label}</strong></button>)}</nav><footer className="sidebar-footer">{demo && <span className="preview-badge">演示数据</span>}{!demo && <button className="quiet-button" onClick={() => void signOut()}>退出登录</button>}</footer></aside><header className="mobile-header"><button className="wordmark" onClick={() => setView("home")}><span className="brand-mark small">E</span><strong>English Lab</strong></button>{demo && <span className="preview-badge">演示</span>}</header><div className="main-surface">{error && <div className="global-notice" role="alert"><span>{error}</span><button onClick={() => void refresh()}>重试</button></div>}{view === "home" && (dashboard ? <Home dashboard={dashboard} startReview={startReview} setView={setView} /> : <div className="center-state">{loading ? "正在整理今天的学习内容…" : "暂时无法读取学习内容。"}</div>)}{view === "questions" && <main className="section-content"><div className="section-intro"><h1>准备今天的题目</h1><p>从到期项目和已确认的新表达中出题。题目导入后即可开始。</p></div><AiJobPanel api={client} kind="question_prepare" subjectId={bootstrap?.queueId} onImported={startReview} /></main>}{view === "phrases" && <PhraseView client={client} />}{view === "context" && <ContextView client={client} />}{view === "candidates" && <CandidateView client={client} />}{view === "settings" && <SettingsView client={client} demo={demo} onSignOut={signOut} onChanged={refresh} />}</div><nav className="bottom-nav" aria-label="移动端主导航">{nav.map((item,index) => <button key={item.target} className={view === item.target ? "active" : ""} onClick={() => setView(item.target)}><span>0{index+1}</span><small>{item.label}</small></button>)}</nav></div>;
}

function Home({dashboard,startReview,setView}: {dashboard: DashboardData;startReview():Promise<void>;setView(view:View):void}) {
  const remaining = Math.max(0,dashboard.today.planned-dashboard.today.completed);
  const days = dashboard.analytics?.days ?? [];
  const sum = (key: "durationMinutes"|"independentSuccess"|"independentAttempts"|"expressionSuccess"|"expressionAttempts") => days.reduce((total,day) => total+(day[key]??0),0);
  const ratio = (success: number, attempts: number) => attempts ? `${Math.round(success/attempts*100)}%（${success}/${attempts}）` : "暂无记录";
  return <main className="home-content"><header className="dashboard-header"><div><p className="eyebrow">{dashboard.learningDate} · DAILY PRACTICE</p><h1>今天</h1><p>练习提取搭配，再把它用进真实表达。</p></div></header><section className="today-card"><div className="today-copy"><p className="eyebrow">TODAY'S SESSION</p><h2>{remaining ? `今天还有 ${remaining} 题` : dashboard.today.planned ? "今天的作答已完成" : "看看今天适合练什么"}</h2><p>每五题同步一次；当前设备保存尚未同步的答案。</p><div className="hero-actions"><button className="primary-button large" onClick={() => void startReview()}>开始 / 继续学习 →</button><button className="secondary-button" onClick={() => setView("settings")}>调整题量</button></div></div></section><section className="metric-grid"><Metric value={dashboard.today.planned} label="今日安排"/><Metric value={dashboard.today.completed} label="今日完成"/><Metric value={dashboard.today.waitingForGrading} label="等待批改"/><Metric value={dashboard.totals.phrases} label="正式学习表达"/></section><section className="glass-card analytics-panel"><p className="eyebrow">LAST 14 DAYS</p><h2>近 14 天的学习表现</h2>{days.length ? <><dl className="analytics-summary"><div><dt>记录用时</dt><dd>{Math.round(sum("durationMinutes"))} 分钟</dd></div><div><dt>无提示目标提取</dt><dd>{ratio(sum("independentSuccess"),sum("independentAttempts"))}</dd></div><div><dt>情境表达成功</dt><dd>{ratio(sum("expressionSuccess"),sum("expressionAttempts"))}</dd></div><div><dt>当前积压</dt><dd>{days.at(-1)?.backlog ?? "—"} 项</dd></div></dl><div className="table-scroll"><table><thead><tr><th>日期</th><th>分钟</th><th>无提示提取</th><th>情境表达</th><th>积压</th></tr></thead><tbody>{days.map(day => <tr key={day.date}><td>{day.date}</td><td>{day.durationMinutes===null?"—":Math.round(day.durationMinutes)}</td><td>{ratio(day.independentSuccess,day.independentAttempts)}</td><td>{ratio(day.expressionSuccess,day.expressionAttempts)}</td><td>{day.backlog??"—"}</td></tr>)}</tbody></table></div></> : <p>新规则下尚无足够的学习记录。完成练习后，这里会显示真实表现。</p>}<p className="muted">历史复习 {dashboard.analytics?.legacyReviews ?? dashboard.totals.reviews} 次。历史成绩与新规则的能力证据分别统计；文字练习不代表口语或发音水平。</p></section><div className="button-row"><button className="secondary-button" onClick={() => setView("context")}>添加真实语料</button><button className="secondary-button" onClick={() => setView("candidates")}>确认学习候选</button><button className="secondary-button" onClick={() => setView("phrases")}>查看搭配与历史</button></div></main>;
}
function Metric({value,label}: {value:number|string;label:string}) {return <div className="metric"><strong>{value}</strong><span>{label}</span></div>;}
