import { TypographyText } from "./TypographyText";
import { useEffect, useRef, useState } from "react";
import type { ApiClient, CheckpointAnswer, Lesson, ReviewBootstrap } from "../lib/contracts";
import { makeIdempotencyKey, sha256Jsonb } from "../lib/hash";
import { loadRecovery, saveRecovery } from "../lib/recovery";
import { ActiveTime } from "../lib/activeTime";
import { PageHeading } from "./PageHeading";
import { mergeLessonRecovery } from "../lib/lessonRecovery";
import { formatLearningDate, learningDateAt } from "../lib/learningDate";
import type { RecoveryState } from "../lib/recovery";
import { useReviewPosition } from "../lib/useReviewPosition";
import { QuestionNavigator } from "./QuestionNavigator";

type Attempt = "answered" | "dont_know" | "skipped";
export function LessonView({api, bootstrap, todayDate=learningDateAt(), onRefresh, onSubmitted}: {api:ApiClient;bootstrap:ReviewBootstrap;todayDate?:string;onRefresh():Promise<void>;onSubmitted(id:string):void}) {
  const session=bootstrap.session!, questions=bootstrap.questions;
  const {selectedQuestion,selectQuestion}=useReviewPosition(session.id,questions);
  const root=useRef<HTMLElement>(null);
  const [lesson,setLesson]=useState<Lesson>(bootstrap.lesson!);
  const [answers,setAnswers]=useState<Map<number,CheckpointAnswer>>(new Map());
  const [inputs,setInputs]=useState<Record<number,string>>({});
  const [hints,setHints]=useState<Record<number,number>>({});
  const [learned,setLearned]=useState<number[]>([]);
  const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
  const [conflictingAnswers,setConflictingAnswers]=useState<CheckpointAnswer[]>([]);
  const [conflict,setConflict]=useState(false),[showText,setShowText]=useState(false);
  const [revealed,setRevealed]=useState<number|null>(null);
  const revision=useRef(session.revision), synced=useRef(new Set<number>()), seconds=useRef<Record<string,number>>({reading:lesson.readingSeconds});
  const clock=useRef(new ActiveTime()), writeChain=useRef(Promise.resolve()), pendingCheckpoint=useRef<{hash:string;key:string}|null>(null), submitKey=useRef(makeIdempotencyKey("lesson-submit"));
  const live=useRef({answers,inputs,hints,learned,ready,busy,revealed,conflict,conflictingAnswers});live.current={answers,inputs,hints,learned,ready,busy,revealed,conflict,conflictingAnswers};
  const lastBootstrap=useRef(bootstrap);
  const review=questions.filter(q=>q.phase==="review"), expression=questions.filter(q=>q.phase==="expression");
  const pendingReview=review.find(q=>!answers.has(q.position));
  const selected=selectedQuestion&&(selectedQuestion.phase!=="expression"||(!pendingReview&&lesson.readingCompleted))?selectedQuestion:undefined;
  const current=selected??pendingReview??(lesson.readingCompleted?expression.find(q=>!answers.has(q.position)):undefined);
  const currentRef=useRef(current);currentRef.current=current;
  const readingRef=useRef(false);readingRef.current=!current&&revealed===null&&lesson.readingStarted&&!lesson.readingCompleted;
  function persist(next=live.current) {
    const snapshot={sessionId:session.id,sessionRevision:revision.current,answers:[...next.answers.values()],checkpointedPositions:[...synced.current],hintCounts:next.hints,learnedPositions:next.learned,updatedAt:new Date().toISOString(),lessonWork:{inputs:next.inputs,seconds:{...seconds.current}}};
    const save=writeChain.current.catch(()=>undefined).then(()=>saveRecovery(snapshot));writeChain.current=save;return save;
  }
  function restore(fresh:ReviewBootstrap, local:RecoveryState|null) {
    const merged=mergeLessonRecovery(fresh,local);
    revision.current=merged.sessionRevision;synced.current=merged.checkpointed;seconds.current=merged.seconds;
    const hasConflict=merged.conflictingAnswers.length>0;
    live.current={...live.current,answers:merged.answers,inputs:merged.inputs,hints:merged.hintCounts,learned:merged.learnedPositions,ready:true,conflict:hasConflict,conflictingAnswers:merged.conflictingAnswers};
    setAnswers(merged.answers);setInputs(merged.inputs);setHints(merged.hintCounts);setLearned(merged.learnedPositions);
    setConflict(hasConflict);setConflictingAnswers(merged.conflictingAnswers);setReady(true);
    if(hasConflict)setError("另一设备已保存不同答案。请核对下面两份内容，再继续云端进度。");
    else setError(current=>current?.includes("REVISION_CONFLICT")?null:current);
    setLesson(previous=>({...fresh.lesson!,readingStarted:previous.readingStarted||fresh.lesson!.readingStarted,
      readingCompleted:previous.readingCompleted||fresh.lesson!.readingCompleted,
      readingSeconds:Math.max(previous.readingSeconds,fresh.lesson!.readingSeconds),material:fresh.lesson!.material??previous.material}));
  }
  useEffect(()=>{
    let cancelled=false;
    void loadRecovery(session.id).then(local=>{
      if(cancelled)return;
      restore(bootstrap,local);lastBootstrap.current=bootstrap;
    }).catch(()=>setError("无法读取本机草稿，请刷新重试。"));
    return()=>{cancelled=true;};
  },[session.id]);
  useEffect(()=>{
    if(!ready||busy||lastBootstrap.current===bootstrap)return;
    lastBootstrap.current=bootstrap;
    // An older in-flight refresh must not roll back a confirmed checkpoint.
    if(session.revision<revision.current)return;
    const state=live.current,localAnswers=new Map(state.answers);
    for(const answer of state.conflictingAnswers)if(answer.clientInstanceId!=="unsubmitted-input")localAnswers.set(answer.position,answer);
    restore(bootstrap,{sessionId:session.id,sessionRevision:revision.current,answers:[...localAnswers.values()],checkpointedPositions:[...synced.current],
      hintCounts:state.hints,learnedPositions:state.learned,lessonWork:{inputs:state.inputs,seconds:{...seconds.current}},updatedAt:new Date().toISOString()});
  },[bootstrap,ready,busy]);
  useEffect(()=>{
    const interact=()=>clock.current.interact();
    const visibility=()=>{clock.current.tick(false);};document.addEventListener("visibilitychange",visibility);
    for(const event of ["keydown","pointerdown","scroll"])window.addEventListener(event,interact,{passive:true});
    const timer=window.setInterval(()=>{const state=live.current;const key=readingRef.current?"reading":currentRef.current?String(currentRef.current.position):null;if(key){seconds.current[key]=(seconds.current[key]??0)+clock.current.tick(state.ready&&!state.busy&&!state.conflict&&state.revealed===null&&(!currentRef.current||!state.answers.has(currentRef.current.position))&&!root.current?.closest("[hidden]")&&document.visibilityState==="visible");}else clock.current.tick(false);},1000);
    let readingSync=false;
    const readingSaver=window.setInterval(()=>{if(readingRef.current&&live.current.ready&&!live.current.busy&&!live.current.conflict&&!readingSync){const value=Math.min(7200,Math.floor(seconds.current.reading??0));readingSync=true;void api.recordLessonActivity!(session.id,"reading_time",value,null,`lesson:${session.id}:reading_time:${value}`).catch(()=>undefined).finally(()=>{readingSync=false;});}},15000);
    const saver=window.setInterval(()=>{if(live.current.ready&&!live.current.conflict)void persist().catch(()=>setError("草稿保存失败，请保持页面打开。"));},5000);
    return()=>{document.removeEventListener("visibilitychange",visibility);window.clearInterval(timer);window.clearInterval(saver);window.clearInterval(readingSaver);for(const event of ["keydown","pointerdown","scroll"])window.removeEventListener(event,interact);};
  },[]);
  async function sync(map:Map<number,CheckpointAnswer>) {
    const batch=[...map.values()].filter(a=>!synced.current.has(a.position)).sort((a,b)=>a.position-b.position);if(!batch.length)return;
    const hash=await sha256Jsonb(batch);if(pendingCheckpoint.current?.hash!==hash)pendingCheckpoint.current={hash,key:makeIdempotencyKey("lesson-checkpoint")};
    const r=await api.checkpointAnswers({sessionId:session.id,answers:batch,sessionRevision:revision.current,idempotencyKey:pendingCheckpoint.current.key,frozenHash:hash});revision.current=r.revision;batch.forEach(a=>synced.current.add(a.position));pendingCheckpoint.current=null;
    await persist({...live.current,answers:map});
  }
  async function act(work:()=>Promise<void>) {if(busy||conflict)return;setBusy(true);setError(null);try{await work();}catch(e){setError((e instanceof Error?e.message:"操作未完成")+"；草稿仍保留，可重试。若提示版本冲突，请刷新以合并云端答案。");}finally{setBusy(false);}}
  async function makeAnswer(position:number,state:Attempt):Promise<CheckpointAnswer> {
    const answer=state==="answered"?(inputs[position]??"").trim():"";
    return {position,answer,revision:1,revealHash:await sha256Jsonb({sessionId:session.id,position,answer,revision:1}),attemptState:state,activeSeconds:Math.min(1800,Math.floor(seconds.current[String(position)]??0)),hintCount:hints[position]??0,hintUsed:(hints[position]??0)>0,learningCardViewed:learned.includes(position),clientInstanceId:"lesson",pageStartedAt:new Date().toISOString(),practiceEndedAt:new Date().toISOString()};
  }
  async function answer(state:Attempt) {if(!current||answers.has(current.position))return;await act(async()=>{const next=new Map(answers).set(current.position,await makeAnswer(current.position,state));await persist({...live.current,answers:next});setAnswers(next);if(state!=="skipped"){selectQuestion(current);setRevealed(current.position);}else selectQuestion();await sync(next);});}
  async function read(action:"reading_start"|"reading_complete") {await act(async()=>{await sync(answers);await api.recordLessonActivity!(session.id,action,Math.min(7200,Math.floor(seconds.current.reading??0)),null,`lesson:${session.id}:${action}:${Math.min(7200,Math.floor(seconds.current.reading??0))}`);const fresh=await api.getReviewBootstrap();if(!fresh.lesson)throw new Error("学习包读取失败");setLesson(fresh.lesson);await onRefresh();});}
  async function finish() {await act(async()=>{
    const next=new Map(answers);for(const q of questions)if(!next.has(q.position))next.set(q.position,await makeAnswer(q.position,"skipped"));
    await persist({...live.current,answers:next});setAnswers(next);await sync(next);
    if(lesson.readingStarted)await api.recordLessonActivity!(session.id,"reading_time",Math.min(7200,Math.floor(seconds.current.reading??0)),null,makeIdempotencyKey("reading-time"));
    const rows=await Promise.all([...next.values()].sort((a,b)=>a.position-b.position).map(async a=>{const q=questions.find(q=>q.position===a.position)!;return {position:a.position,questionId:q.id,answer:a.answer,revision:a.revision,answerHash:await sha256Jsonb({questionId:q.id,answer:a.answer,revision:a.revision})};}));
    const r=await api.submitSession({sessionId:session.id,answers:[],sessionRevision:revision.current,idempotencyKey:submitKey.current,frozenHash:await sha256Jsonb(rows)});selectQuestion();onSubmitted(r.submissionId);
  });}
  const refQuestion=questions.find(q=>q.position===revealed)??(selected&&answers.has(selected.position)?selected:undefined);
  const learning=current?.isNew&&current.learningCard&&!learned.includes(current.position);
  const resumed=bootstrap.learningDate<todayDate;
  return <section ref={root} className="page-stack lesson-view"><PageHeading eyebrow={resumed?`${formatLearningDate(bootstrap.learningDate)} · 继续未完成的学习`:"连贯内容 · 主动表达"} title={resumed?"接着上次，继续学":"今天，学会表达一件事"} description={resumed?"已保存的进度已恢复，继续完成这次学习即可。":"约 15–20 分钟 · 先独立回忆，再阅读与回应。"}/>
    <div className="session-summary"><span>复习 {review.filter(q=>answers.has(q.position)).length}/{review.length}</span><span>阅读 {lesson.readingCompleted?"已完成":"待阅读"}</span><span>表达 {expression.filter(q=>answers.has(q.position)).length}/{expression.length}</span></div>
    <div className="review-question-layout">
    {!ready?<p>正在恢复学习进度…</p>:conflict?<article className="card content-card"><h2>请先核对不同设备的答案</h2><p>本机答案或未提交输入：</p><pre>{JSON.stringify(conflictingAnswers.map(a=>({题号:a.position,答案:a.answer,状态:a.attemptState})),null,2)}</pre><p>云端已作答：</p><pre>{JSON.stringify(conflictingAnswers.map(a=>({题号:a.position,答案:answers.get(a.position)?.answer,状态:answers.get(a.position)?.attemptState})),null,2)}</pre><p>本机未提交输入仍会保留。</p><button onClick={()=>{setConflict(false);setConflictingAnswers([]);setError(null);void persist({...live.current,conflict:false,conflictingAnswers:[]});}}>已核对，继续云端进度</button></article>:refQuestion?<article className="card content-card"><span className="question-number">第 {questions.findIndex(q=>q.id===refQuestion.id)+1} / {questions.length} 题</span><h2><TypographyText text={refQuestion.promptZh}/></h2><label className="answer-field">你的表达<textarea value={answers.get(refQuestion.position)?.answer??""} disabled/></label><p className="muted">{answers.get(refQuestion.position)?.attemptState==="skipped"?"这道题已跳过":answers.get(refQuestion.position)?.attemptState==="dont_know"?"已记录暂时不会":"答案已保存"}</p><h2>参考表达</h2><p lang="en">{refQuestion.expectedAnswers[0]}</p><p>详细反馈会在本次批改后呈现。</p><button className="primary-button" disabled={busy} onClick={()=>{setRevealed(null);selectQuestion();}}>继续</button></article>:current?<article className="card question-card">
      <header className="question-meta"><span>{current.phase==="expression"?"读后表达练习":"独立复习"}</span><span className="question-number">第 {questions.findIndex(q=>q.id===current.id)+1} / {questions.length} 题 · {current.answerForm==="gap"?"填指定空格":current.answerForm==="response"?"写一两句回应":"写完整词块"}</span></header>
      {learning?<section className="question-body"><h2>先熟悉这个表达</h2><p>{current.learningCard!.meaningZh}</p><blockquote lang="en">{current.learningCard!.example}</blockquote><p>{current.learningCard!.usageNote}</p><button className="primary-button" disabled={busy} onClick={()=>void act(async()=>{const next=[...learned,current.position];await persist({...live.current,learned:next});setLearned(next);await api.recordQuestionActivity(session.id,current.position,"study",`lesson:${session.id}:study:${current.position}`);})}>隐藏学习卡，试着回忆</button><button className="text-button" disabled={busy} onClick={()=>void answer("skipped")}>跳过</button></section>:<section className="question-body">
        <h2><TypographyText text={current.promptZh}/></h2>{current.promptEn&&<p lang="en">{current.promptEn}</p>}
        {current.phase==="expression"&&<><p className="muted">已读过材料，这次练习不会提升复习阶段。</p><button className="text-button" onClick={()=>setShowText(!showText)}>{showText?"收起原文":"重看原文"}</button>{showText&&<p className="lesson-reading" lang="en">{lesson.material?.body}</p>}</>}
        {(current.hints??[]).slice(0,hints[current.position]??0).map((hint,i)=><p key={i} className="hint-box">{hint}</p>)}
        <label className="answer-field">你的表达<textarea value={inputs[current.position]??""} disabled={busy} onChange={e=>{const next={...inputs,[current.position]:e.target.value};setInputs(next);void persist({...live.current,inputs:next}).catch(()=>setError("草稿保存失败，请保持页面打开。"));}}/></label>
        <div className="button-row"><button className="primary-button" disabled={busy||!(inputs[current.position]??"").trim()} onClick={()=>void answer("answered")}>保存并看参考</button><button className="secondary-button" disabled={busy} onClick={()=>void answer("dont_know")}>暂时不会</button><button className="text-button" disabled={busy} onClick={()=>void answer("skipped")}>跳过</button></div>
        {(hints[current.position]??0)<(current.hints??[]).length&&<button className="text-button" disabled={busy} onClick={()=>void act(async()=>{const count=(hints[current.position]??0)+1;const next={...hints,[current.position]:count};await persist({...live.current,hints:next});setHints(next);await api.recordQuestionActivity(session.id,current.position,"hint",`lesson:${session.id}:hint:${current.position}:${count}`);})}>需要提示</button>}
      </section>}
    </article>:!lesson.readingStarted?<article className="card content-card"><h2>接下来，读一段完整内容</h2><p>已完成的复习先保存，再打开材料。</p><button className="primary-button" disabled={busy} onClick={()=>void read("reading_start")}>开始阅读</button></article>:!lesson.readingCompleted?<article className="card content-card"><span className="type-chip">{lesson.theme==="life"?"生活中的英语":"工作中的英语"}</span><h2>{lesson.material?.title}</h2><p lang="en" className="lesson-reading">{lesson.material?.body}</p><details><summary>需要中文帮助</summary><p>{lesson.material?.explanationZh}</p>{lesson.material?.notes.map(note=><p key={note.phraseId}>{note.explanationZh}</p>)}</details><button className="primary-button" disabled={busy} onClick={()=>void read("reading_complete")}>收起原文，试着回应</button></article>:<article className="card content-card"><h2>本次练习已完成</h2><p>接下来一次批改，区分独立回忆与读后的表达。</p><button className="primary-button" disabled={busy} onClick={()=>void finish()}>提交本次学习</button></article>}
    <QuestionNavigator questions={questions} currentId={refQuestion?.id??current?.id} answers={answers} inputs={inputs} disabled={!ready||busy||conflict} lockedIds={new Set(expression.filter(()=>Boolean(pendingReview)||!lesson.readingCompleted).map(q=>q.id))} onSelect={question=>{setRevealed(null);setShowText(false);selectQuestion(question);}}/>
    </div>
    {ready&&!conflict&&<button className="text-button" disabled={busy} onClick={()=>void finish()}>结束本次并批改已答内容</button>}
    {error&&<div><p className="inline-error" role="alert">{error}</p>{!conflict&&<button className="secondary-button" disabled={busy} onClick={()=>void act(onRefresh)}>刷新云端进度</button>}</div>}{busy&&<p role="status">正在保存…</p>}
  </section>;
}
