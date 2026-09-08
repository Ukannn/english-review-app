import { BookOpen, Check, CloudOff, LoaderCircle, RefreshCw, Settings2 } from "lucide-react";
import { useState } from "react";
import type { ApiClient, DashboardData, ReviewBootstrap } from "../lib/contracts";
import type { ViewId } from "./AppShell";
import { AiHandoff } from "./AiHandoff";
import { AiJobPanel } from "./AiJobPanel";
import { PageHeading } from "./PageHeading";
import { ProgressOrb } from "./ProgressOrb";
import { ReviewView } from "./ReviewView";
import { QuestionCountSettings } from "./SettingsView";

export function TodayView({ client, bootstrap, dashboard, loading, demo, online, onRefresh, onNavigate }: {
  client: ApiClient; bootstrap: ReviewBootstrap | null; dashboard: DashboardData | null; loading: boolean;
  demo: boolean; online: boolean; onRefresh(): Promise<void>; onNavigate(view: ViewId): void;
}) {
  const [showCount, setShowCount] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [finished, setFinished] = useState<string | null>(null);
  const submissionId = submitted ?? bootstrap?.session?.submissionId;
  if (!bootstrap) return <div className="loading-card card"><LoaderCircle className={loading ? "spin" : ""}/><p>{loading ? "正在准备今日学习…" : "今日学习暂时无法读取。"}</p>{!loading && <button className="secondary-button" onClick={() => void onRefresh()}>重新加载</button>}</div>;
  const countButton = <button className="icon-button" aria-label="调整今日题量" aria-expanded={showCount} onClick={() => setShowCount(value => !value)}><Settings2 size={19}/></button>;
  const countForm = showCount && <QuestionCountSettings client={client} demo={demo} onChanged={onRefresh}/>;
  if (submissionId && finished !== submissionId) return <AiHandoff key={submissionId} api={client} submissionId={submissionId} onDone={() => {setFinished(submissionId); void onRefresh();}} onClose={() => onNavigate("analytics")}/>;
  if (!submissionId && bootstrap.state === "open" && bootstrap.session && bootstrap.questions.length) return <div className="page-stack">{countForm}<ReviewView key={bootstrap.session.id} api={client} bootstrap={bootstrap} headerAction={countButton} onClose={() => onNavigate("library")} onSubmitted={id => {setSubmitted(id); void onRefresh();}}/></div>;
  const planned = bootstrap.actualCount ?? dashboard?.today.planned ?? 0;
  const completed = dashboard?.today.completed ?? 0;
  return <section className="page-stack view-enter">
    <PageHeading today eyebrow={`${bootstrap.learningDate} · 今天`} title="今天，也前进一步" description="从复习到新表达，开始今天的英语学习。" action={<div className="today-actions">{countButton}<ProgressOrb value={completed} total={planned}/></div>}/>
    {countForm}
    {!online && <div className="notice"><CloudOff size={17}/><span>当前离线，联网后即可继续准备题目与批改。</span></div>}
    {bootstrap.state === "questions_required" ? <>
      <article className="empty-state card"><div className="empty-symbol" aria-hidden="true"><span/><span/></div><h2>今天的学习已安排</h2><p>共 {planned} 题。让 ChatGPT 准备题目，保存后会在这里自动开始。</p><AiJobPanel api={client} kind="question_prepare" subjectId={bootstrap.queueId} onImported={onRefresh}/></article>
    </> : <article className="empty-state card">{completed || submissionId ? <Check size={36}/> : <BookOpen size={36}/>}<h2>{completed || submissionId ? "今天的学习已完成" : "今天没有到期复习"}</h2><p>{completed || submissionId ? "让新表达沉淀一下，下次复习再见。" : "留下真实语境中的表达，或到资料库看看想学的内容。"}</p><div className="button-row"><button className="primary-button" onClick={() => onNavigate("intake")}>添加语料</button><button className="secondary-button" onClick={() => onNavigate("library")}>打开学习资料库</button><button className="icon-button" aria-label="刷新今日学习" onClick={() => void onRefresh()}><RefreshCw size={18}/></button></div></article>}
  </section>;
}
