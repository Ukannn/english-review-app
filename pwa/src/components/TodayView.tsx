import { BookOpen, CloudOff, LoaderCircle, RefreshCw, Settings2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient, DashboardData, ReviewBootstrap, SubmissionStatus } from "../lib/contracts";
import { formatLearningDate } from "../lib/learningDate";
import type { ViewId } from "./AppShell";
import { AiHandoff } from "./AiHandoff";
import { AiJobPanel } from "./AiJobPanel";
import { FeedbackCarousel } from "./FeedbackCarousel";
import { Modal } from "./Modal";
import { PageHeading } from "./PageHeading";
import { LessonView } from "./LessonView";
import { ReviewView } from "./ReviewView";
import { QuestionCountSettings } from "./SettingsView";

export function TodayView({ client, bootstrap, dashboard, loading, demo, online, active = true, onRefresh, onNavigate }: {
  client: ApiClient; bootstrap: ReviewBootstrap | null; dashboard: DashboardData | null; loading: boolean;
  demo: boolean; online: boolean; active?: boolean; onRefresh(): Promise<void>; onNavigate(view: ViewId): void;
}) {
  const [showCount, setShowCount] = useState(false);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<SubmissionStatus | null>(null);
  const [feedbackError, setFeedbackError] = useState("");
  const [openPosition, setOpenPosition] = useState<number | null>(null);
  const feedbackRequest = useRef(0);
  const feedbackSubmission = useRef<string | null | undefined>(undefined);
  const submissionId = submitted ?? bootstrap?.session?.submissionId;
  const readFeedback = useCallback(async () => {
    if (!submissionId) return;
    const request = ++feedbackRequest.current;
    try {
      const next = await client.getSubmissionStatus(submissionId);
      if (bootstrap?.session && next.sessionId !== bootstrap.session.id) throw new Error("反馈与当前会话不一致，请重新加载。");
      if (request === feedbackRequest.current) { setFeedback(next); setFeedbackError(""); }
    } catch (caught) { if (request === feedbackRequest.current) setFeedbackError(caught instanceof Error ? caught.message : "反馈暂时无法读取。"); }
  }, [client, submissionId, bootstrap?.session?.id]);
  useEffect(() => {
    if (feedbackSubmission.current !== submissionId) { setFeedback(null); setFeedbackError(""); setOpenPosition(null); feedbackSubmission.current = submissionId; }
    void readFeedback();
    return () => { feedbackRequest.current++; };
  }, [readFeedback, submissionId]);
  useEffect(() => { if (!active) setOpenPosition(null); }, [active]);
  if (!bootstrap) return <div className="loading-card card"><LoaderCircle className={loading ? "spin" : ""}/><p>{loading ? "正在准备今日学习…" : "今日学习暂时无法读取。"}</p>{!loading && <button className="secondary-button" onClick={() => void onRefresh()}>重新加载</button>}</div>;
  const countButton = <button className="icon-button" aria-label={bootstrap.ruleVersion === "english_v3" ? "调整后续独立复习量" : "调整今日题量"} onClick={() => bootstrap.ruleVersion === "english_v3" ? onNavigate("status") : setShowCount(value => !value)}><Settings2 size={19}/></button>;
  const countForm = showCount && <QuestionCountSettings client={client} demo={demo} onChanged={onRefresh}/>;
  if (submissionId && !feedback) return <section className="loading-card card"><LoaderCircle className={!feedbackError ? "spin" : ""}/><p role={feedbackError ? "alert" : "status"}>{feedbackError || "正在读取本次反馈…"}</p>{feedbackError && <button className="secondary-button" onClick={() => void readFeedback()}>重试读取反馈</button>}</section>;
  if (submissionId && feedback?.status !== "committed") return <AiHandoff key={submissionId} api={client} submissionId={submissionId} questions={bootstrap.questions} onChanged={async () => { await readFeedback(); await onRefresh(); }} onDone={() => void readFeedback()} onClose={() => onNavigate("analytics")}/>;
  if (!submissionId && bootstrap.ruleVersion === "english_v3" && bootstrap.state === "open" && bootstrap.session && bootstrap.lesson) return <LessonView key={bootstrap.session.id} api={client} bootstrap={bootstrap} onRefresh={onRefresh} onSubmitted={id => { setSubmitted(id); void onRefresh(); }}/>;
  if (!submissionId && bootstrap.state === "open" && bootstrap.session && bootstrap.questions.length) return <div className="page-stack">{countForm}<ReviewView key={bootstrap.session.id} api={client} bootstrap={bootstrap} headerAction={countButton} onClose={() => onNavigate("library")} onSubmitted={id => { setSubmitted(id); void onRefresh(); }}/></div>;
  const sameDay = !dashboard || bootstrap.learningDate === dashboard.learningDate;
  const done = feedback?.status === "committed";
  const planned = sameDay ? dashboard?.today.planned ?? bootstrap.actualCount ?? 0 : bootstrap.session?.maxQuestions ?? 0;
  const completed = sameDay ? dashboard?.today.completed ?? 0 : done ? (feedback?.grades.length ?? 0) + (feedback?.lessonSummary?.skipped ?? 0) : 0;
  return <section className={`page-stack today-page view-enter ${done ? "today-page--completed" : ""}`}>
    <PageHeading today eyebrow={`${formatLearningDate(bootstrap.learningDate)} · ${sameDay ? "英语" : "历史会话"}`} title={done ? sameDay ? "今天已完成" : "这次学习已完成" : "今天，也前进一步"} description={done ? "" : "少量复习，一段阅读，再把表达用起来。"} action={<div className="today-count" aria-label={`本次已作答 ${completed}/${planned}`}><strong>{completed} / {planned}</strong> 项已作答</div>}/>
    {countForm}
    {!online && <div className="notice"><CloudOff size={17}/><span>当前离线，联网后即可继续读取与保存。</span></div>}
    {feedbackError && <p className="inline-error" role="alert">{feedbackError} {feedback && "保留此前成功读取的本次反馈。"}<button className="text-button" onClick={() => void readFeedback()}>重新读取</button></p>}
    {done && feedback ? <>
      <FeedbackCarousel grades={feedback.grades} active={active && openPosition === null} onOpen={setOpenPosition}/>
      {openPosition !== null && <Modal title={`${formatLearningDate(bootstrap.learningDate)} · 本次完整反馈`} onClose={() => setOpenPosition(null)}><AiHandoff api={client} submissionId={submissionId!} questions={bootstrap.questions} focusPosition={openPosition} onChanged={async () => { await readFeedback(); await onRefresh(); }} onDone={() => setOpenPosition(null)} onClose={() => setOpenPosition(null)}/></Modal>}
    </> : bootstrap.state === "questions_required" ? <article className="empty-state card"><div className="empty-symbol" aria-hidden="true"><span/><span/></div><h2>今天的学习已安排</h2><p>{bootstrap.ruleVersion === "english_v3" ? "约 15–20 分钟：少量复习、一段阅读、两次表达。让 ChatGPT 一次准备完整内容。" : `共 ${planned} 题。让 ChatGPT 准备题目，保存后会在这里自动开始。`}</p><AiJobPanel api={client} kind="question_prepare" subjectId={bootstrap.queueId} onImported={onRefresh}/></article> : <article className="empty-state card"><BookOpen size={36}/><h2>今天没有到期复习</h2><p>留下真实语境中的表达，或到资料库看看想学的内容。</p><div className="button-row"><button className="primary-button" onClick={() => onNavigate("intake")}>添加语料</button><button className="secondary-button" onClick={() => onNavigate("library")}>打开学习资料库</button><button className="icon-button" aria-label="刷新今日学习" onClick={() => void onRefresh()}><RefreshCw size={18}/></button></div></article>}
  </section>;
}
