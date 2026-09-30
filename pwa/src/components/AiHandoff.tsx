import { RefreshCw } from "lucide-react";
import { PageHeading } from "./PageHeading";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient, ConfirmationDecision, GradeStatus, ReviewQuestion, SubmissionStatus } from "../lib/contracts";
import { makeIdempotencyKey, sha256Jsonb } from "../lib/hash";
import { AiJobPanel } from "./AiJobPanel";

export function AiHandoff({ api, submissionId, onDone, onChanged, questions = [], focusPosition }: { api: ApiClient; submissionId: string; onDone(): void; onClose(): void; onChanged?(): Promise<void>; questions?: ReviewQuestion[]; focusPosition?: number }) {
  const [status, setStatus] = useState<SubmissionStatus | null>(null);
  const [decisions, setDecisions] = useState<Record<number, ConfirmationDecision>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const confirmKey = useRef(makeIdempotencyKey(`confirm:${submissionId}`));
  const refresh = useCallback(async () => {
    try { setStatus(await api.getSubmissionStatus(submissionId)); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : "无法读取批改状态。"); }
  }, [api, submissionId]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (status && focusPosition) document.getElementById(`feedback-question-${focusPosition}`)?.scrollIntoView?.({ block: "nearest" }); }, [status, focusPosition]);
  async function confirm() {
    if (!status) return; setBusy(true); setMessage(null);
    try {
      const pending = status.grades.filter(grade => grade.status !== "committed");
      const chosen: ConfirmationDecision[] = pending.map(grade => decisions[grade.position] ?? { position: grade.position, decision: "accept" });
      await api.confirmGrades(submissionId, chosen, status.revision, confirmKey.current, await sha256Jsonb(chosen));
      confirmKey.current = makeIdempotencyKey(`confirm:${submissionId}`); setDecisions({}); await refresh(); await onChanged?.(); setMessage("批改决定已保存。");
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "确认失败，请刷新后重试。"); }
    finally { setBusy(false); }
  }
  async function retry() {
    if (!status) return; setBusy(true);
    try { await api.retrySubmissionCommit(submissionId, status.revision, makeIdempotencyKey(`retry:${submissionId}`)); await refresh(); await onChanged?.(); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : "重试失败。"); }
    finally { setBusy(false); }
  }
  return <section className="page-stack view-enter"><PageHeading eyebrow="让每一次练习留下收获" title={status?.status === "committed" ? "本次学习已完成" : "批改与确认"} description="回看表达，确认这次练习的收获。" action={<button className="icon-button" aria-label="刷新批改状态" onClick={() => void refresh()}><RefreshCw size={19}/></button>}/><div className="page-stack">{!status&&<p role="status">正在读取批改状态…</p>}<section className="card grading-summary"><p>{status?.status === "committed" ? "本次结果已保存，复习安排已确认。可以安心结束，或回看逐题反馈。" : status?.status === "needs_confirmation" ? "批改已完成。核对结果后，再确认复习安排。" : status?.status === "failed" ? "原答已保存，结果尚未完成保存，请查看错误并重试。" : "答案已保存，正在等待批改。复习安排尚未确认。"}</p>{status?.status === "committed" && <button className="primary-button" onClick={onDone}>返回今天</button>}{status?.errorCode && <p role="alert">{status.errorDetail || status.errorCode}</p>}</section>{status && !["committed", "needs_confirmation"].includes(status.status) && <AiJobPanel api={api} kind="grade_submission" subjectId={submissionId} onImported={async () => {setDecisions({});await refresh();}} />}{status?.lessonSummary&&<section className="card"><h2>{status.lessonSummary.title}</h2>{status.lessonSummary.expressions&&<p>练过的表达：{status.lessonSummary.expressions.join(" · ")}</p>}<p>{status.lessonSummary.nextFocus}</p>{status.grades.filter(g=>g.targetOutcome==="partial"||g.targetOutcome==="forgotten"||g.naturalness!=="natural").slice(0,2).map(g=><p key={g.position}>{g.feedbackZh}</p>)}{status.lessonSummary.skipped>0&&<p>{status.lessonSummary.skipped} 项未尝试，未作为失败处理。</p>}<BurdenFeedback api={api} sessionId={status.sessionId} initial={status.lessonSummary.burden}/></section>}
 <details open={Boolean(focusPosition) || !status?.lessonSummary}><summary>查看逐项反馈与批改决定</summary><div className="results-grid">{status?.grades.map(grade => <GradeCard key={grade.position} question={questions.find(q=>q.position===grade.position)} grade={grade} decision={decisions[grade.position]} editable={status.status === "needs_confirmation"} onChange={decision => {confirmKey.current = makeIdempotencyKey(`confirm:${submissionId}`);setDecisions(current => ({ ...current, [grade.position]: decision }));}} />)}</div></details>{status?.status === "committed" && status.grades.flatMap(grade => grade.extraPractice.map((practice,index) => <ExtraPracticeCard key={`${grade.position}:${index}`} api={api} submissionId={submissionId} prompt={practice.promptZh??practice.prompt??"请换一个场景使用目标表达。"} reference={practice.referenceAnswer}/>))}{status?.status === "needs_confirmation" && <button className="primary-button" disabled={busy} onClick={() => void confirm()}>{busy ? "正在保存…" : "确认以上批改并更新复习安排"}</button>}{status?.status === "failed" && <button className="secondary-button" disabled={busy} onClick={() => void retry()}>重试保存批改结果</button>}{message && <p role="status">{message}</p>}</div></section>;
}
const outcomes = { correct: "目标正确提取", partial: "目标部分正确", forgotten: "未能回忆 / 目标错误", not_measured: "使用了合理别答，目标未测到" };
const naturalnessLabels = { natural: "自然", minor_issue: "小问题", major_issue: "明显问题" };
export function GradeCard({ grade, question, decision, editable, onChange }: { grade: GradeStatus; question?: ReviewQuestion; decision?: ConfirmationDecision; editable: boolean; onChange(decision: ConfirmationDecision): void }) {
  const value: ConfirmationDecision = decision ?? { position: grade.position, decision: "accept", targetOutcome: grade.targetOutcome ?? (grade.result === "forgotten" ? "forgotten" : grade.result === "difficult" ? "partial" : "correct"), meaningOk: grade.meaningOk ?? true, naturalness: grade.naturalness ?? "natural" };
  return <article id={`feedback-question-${grade.position}`} className="card result-card grade-card"><h2>第 {grade.position} 题</h2>{question && <p className="grade-prompt">{question.promptZh || question.promptEn || "原题未提供"}</p>}<p>你的答案</p><p className="grade-answer" lang="en">{grade.observedAnswer}</p><p>参考：{grade.expectedAnswer}</p><p>{grade.feedbackZh}</p>{grade.hintUsed && <span className="stage-badge">使用过提示</span>}{editable ? <><p className="grade-summary">{value.targetOutcome ? outcomes[value.targetOutcome] : grade.result} · {value.meaningOk ? "意思成立" : "意思未成立"}</p><details><summary>调整此题批改</summary><fieldset><legend>核对并按需修正</legend><label>处理方式<select value={value.decision} onChange={event => onChange({...value, decision: event.target.value as ConfirmationDecision["decision"]})}><option value="accept">采用（可在下方修正）</option><option value="reject">退回重新批改</option></select></label><label>目标提取<select value={value.targetOutcome} onChange={event => onChange({ ...value, targetOutcome: event.target.value as ConfirmationDecision["targetOutcome"] })}>{Object.entries(outcomes).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>意思<select value={String(value.meaningOk)} onChange={event => onChange({ ...value, meaningOk: event.target.value === "true" })}><option value="true">表达成立</option><option value="false">表达未成立</option></select></label><label>自然度<select value={value.naturalness} onChange={event => onChange({ ...value, naturalness: event.target.value as ConfirmationDecision["naturalness"] })}><option value="natural">自然</option><option value="minor_issue">小问题</option><option value="major_issue">明显问题</option></select></label></fieldset></details></> : <div><p>{grade.targetOutcome ? outcomes[grade.targetOutcome] : grade.result}</p>{grade.meaningOk !== undefined && <p>意思：{grade.meaningOk ? "表达成立" : "表达未成立"}</p>}{grade.naturalness && <p>自然度：{naturalnessLabels[grade.naturalness]}</p>}</div>}{question?.phraseId && <a className="text-button feedback-history-link" href={`#history?phrase=${encodeURIComponent(question.phraseId)}`}>查看这个表达的练习历史 ↗</a>}</article>;
}

function ExtraPracticeCard({ api, submissionId, prompt, reference }: { api: ApiClient; submissionId: string; prompt: string; reference?: string }) {
  const [answer,setAnswer]=useState("");const [saved,setSaved]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);const key=useRef(makeIdempotencyKey("extra-practice"));
  async function save(){if(!answer.trim())return;setBusy(true);try{await api.submitExtraPractice(submissionId,null,"targeted_retry",prompt,answer.trim(),reference??null,key.current);setSaved(true);}catch(caught){setError(caught instanceof Error?caught.message:"补充练习保存失败。");}finally{setBusy(false);}}
  return <section className="card practice-card"><h3>补充练习</h3><p>{prompt}</p><p className="muted">用于练习薄弱点，不再次推进今天的复习阶段。</p><label className="answer-field"><span>补充练习答案</span><textarea value={answer} onChange={event=>setAnswer(event.target.value)} disabled={saved}/></label>{saved?<p role="status">练习已保存。{reference&&`参考：${reference}`}</p>:<button className="secondary-button" disabled={busy||!answer.trim()} onClick={()=>void save()}>保存补充练习</button>}{error&&<p role="alert">{error}</p>}</section>;
}

function BurdenFeedback({api,sessionId,initial}:{api:ApiClient;sessionId:string;initial:string|null}) {
 const [value,setValue]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function choose(next:string){setBusy(true);try{await api.recordLessonActivity!(sessionId,"burden",0,next,makeIdempotencyKey("burden"));setValue(next);setError("");}catch{setError("反馈未保存，可重试。");}finally{setBusy(false);}}
 return <div><p>这次负担如何？（可不选）</p><div className="button-row">{([["light","轻松"],["right","合适"],["heavy","偏重"]] as const).map(([v,label])=><button key={v} className={value===v?"primary-button":"secondary-button"} disabled={busy} onClick={()=>void choose(v)}>{label}</button>)}</div>{error&&<p role="alert">{error}</p>}</div>;
}
