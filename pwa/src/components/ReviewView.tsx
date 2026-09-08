import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient, CheckpointAnswer, ReviewBootstrap } from "../lib/contracts";
import { makeIdempotencyKey, sha256Jsonb } from "../lib/hash";
import { clearRecovery, loadRecovery, recordActivity, saveRecovery, syncPendingActivities } from "../lib/recovery";

interface Props { api: ApiClient; bootstrap: ReviewBootstrap; onClose(): void; onSubmitted(submissionId: string): void }
function cloudAnswers(bootstrap: ReviewBootstrap) {
  return new Map<number, CheckpointAnswer>(bootstrap.questions.filter(q=>q.draft).map(q=>[q.position, {position:q.position,answer:q.draft!.answer,revision:q.draft!.revision,revealHash:q.draft!.answerHash,clientInstanceId:"cloud-recovery",pageStartedAt:new Date().toISOString(),hintUsed:q.draft!.hintUsed,hintCount:q.draft!.hintCount,learningCardViewed:q.draft!.learningCardViewed}]));
}
export function ReviewView({api,bootstrap,onClose,onSubmitted}:Props) {
  const session=bootstrap.session!;
  const questions=useMemo(()=>[...bootstrap.questions].sort((a,b)=>Number(Boolean(a.isNew))-Number(Boolean(b.isNew))||a.position-b.position),[bootstrap.questions]);
  const [index,setIndex]=useState(0);
  const [answers,setAnswers]=useState(()=>cloudAnswers(bootstrap));
  const [checkpointed,setCheckpointed]=useState(()=>new Set(bootstrap.questions.filter(q=>q.draft).map(q=>q.position)));
  const [sessionRevision,setSessionRevision]=useState(session.revision);
  const [hintCounts,setHintCounts]=useState<Record<number,number>>(()=>Object.fromEntries(questions.map(q=>[q.position,q.draft?.hintCount??q.hintCount??0])));
  const [learned,setLearned]=useState<Set<number>>(()=>new Set(questions.filter(q=>q.draft?.learningCardViewed||q.learningCardViewed).map(q=>q.position)));
  const [restoring,setRestoring]=useState(true);
  const [conflicts,setConflicts]=useState<CheckpointAnswer[]>([]);
  const [syncing,setSyncing]=useState(false);const [submitting,setSubmitting]=useState(false);const [revealing,setRevealing]=useState(false);
  const [error,setError]=useState<string|null>(null);const [input,setInput]=useState("");
  const pageStartedAt=useRef(new Date().toISOString());const clientInstanceId=useRef(crypto.randomUUID());const questionStartedAt=useRef(new Date().toISOString());const syncingRef=useRef(false);
  const pendingRequest=useRef<{signature:string;key:string}|null>(null);const submitKey=useRef(makeIdempotencyKey(`submit:${session.id}`));
  const question=questions[index];
  const isRevealed=answers.has(question.position);
  const studyQuestion=questions.find(q=>q.isNew&&q.learningCard&&!learned.has(q.position)&&!answers.has(q.position));
  const answeredCount=answers.size;const allRevealed=answeredCount===questions.length;
  const safeBoundary=question.semanticBoundary&&!question.expectedAnswers.concat(question.acceptedVariants).some(answer=>answer.trim().length>2&&question.semanticBoundary!.toLowerCase().includes(answer.trim().toLowerCase()))?question.semanticBoundary:null;

  useEffect(()=>{
    let active=true;
    void loadRecovery(session.id).then(recovery=>{
      if(!active||!recovery)return;
      const next=cloudAnswers(bootstrap);const collisions:CheckpointAnswer[]=[];
      for(const local of recovery.answers){
        const target=questions.find(q=>q.position===local.position);
        if(!target){collisions.push(local);continue;}
        const cloud=next.get(local.position);
        if(cloud&&cloud.answer!==local.answer){collisions.push(local);continue;}
        if(!cloud)next.set(local.position,local);
      }
      setAnswers(next);setConflicts(collisions);
      // Only the current bootstrap proves which answers reached the cloud.
      setCheckpointed(new Set(bootstrap.questions.filter(q=>q.draft).map(q=>q.position)));
      setSessionRevision(session.revision);
      setHintCounts(current=>{const merged={...current};for(const [position,count] of Object.entries(recovery.hintCounts??{}))merged[Number(position)]=Math.max(merged[Number(position)]??0,count);return merged;});
      setLearned(current=>new Set([...current,...(recovery.learnedPositions??[])]));
    }).catch(()=>{if(active)setError("本机恢复记录暂时无法读取，请重试后继续。");}).finally(()=>{if(active)setRestoring(false);});
    return()=>{active=false;};
  },[session.id]);
  useEffect(()=>{setInput(answers.get(question.position)?.answer??"");},[answers,question.position]);
  useEffect(()=>{questionStartedAt.current=new Date().toISOString();},[question.position,Boolean(studyQuestion)]);
  useEffect(()=>{const sync=()=>{void syncPendingActivities(api).catch(()=>undefined);};window.addEventListener("online",sync);sync();return()=>window.removeEventListener("online",sync);},[api]);
  const orderedAnswers=useMemo(()=>Array.from(answers.values()).sort((a,b)=>a.position-b.position),[answers]);
  async function persist(nextAnswers=answers,nextCheckpointed=checkpointed,nextRevision=sessionRevision,nextHints=hintCounts,nextLearned=learned){
    await saveRecovery({sessionId:session.id,sessionRevision:nextRevision,answers:Array.from(nextAnswers.values()),checkpointedPositions:Array.from(nextCheckpointed),updatedAt:new Date().toISOString(),hintCounts:nextHints,learnedPositions:Array.from(nextLearned)});
  }
  async function checkpoint(batch:CheckpointAnswer[],snapshot=answers){
    if(!batch.length||syncingRef.current||conflicts.length)return;
    syncingRef.current=true;setSyncing(true);setError(null);
    try{
      const frozenHash=await sha256Jsonb(batch);const signature=`${sessionRevision}:${frozenHash}`;
      if(pendingRequest.current?.signature!==signature)pendingRequest.current={signature,key:makeIdempotencyKey(`checkpoint:${session.id}`)};
      const result=await api.checkpointAnswers({sessionId:session.id,answers:batch,sessionRevision,idempotencyKey:pendingRequest.current.key,frozenHash});
      const next=new Set(checkpointed);batch.forEach(answer=>next.add(answer.position));setCheckpointed(next);setSessionRevision(result.revision);pendingRequest.current=null;await persist(snapshot,next,result.revision);
    }catch(caught){setError((caught instanceof Error?caught.message:"同步未完成")+"。答案保存在本机。可重试同步；若其他设备已修改，请返回首页重新打开。");}
    finally{syncingRef.current=false;setSyncing(false);}
  }
  async function reveal(){
    const value=input.trim();if(!value||isRevealed||restoring||conflicts.length||revealing)return;
    setRevealing(true);setError(null);
    try{
      const revision=1;const answer:CheckpointAnswer={position:question.position,answer:value,revision,revealHash:await sha256Jsonb({sessionId:session.id,position:question.position,answer:value,revision}),clientInstanceId:clientInstanceId.current,pageStartedAt:pageStartedAt.current,practiceStartedAt:questionStartedAt.current,practiceEndedAt:new Date().toISOString(),hintUsed:(hintCounts[question.position]??0)>0,hintCount:hintCounts[question.position]??0,learningCardViewed:learned.has(question.position)};
      const next=new Map(answers).set(question.position,answer);
      await persist(next);setAnswers(next);void recordActivity(api,session.id,question.position,"reveal").catch(()=>setError("活动记录未保存，请保持页面打开并重试同步。"));
      const pending=Array.from(next.values()).filter(entry=>!checkpointed.has(entry.position)).sort((a,b)=>a.position-b.position);
      if(pending.length>=5)void checkpoint(pending.slice(0,5),next);
    }catch{setError("本机保存失败。请保持页面打开，检查浏览器存储后重试。");}
    finally{setRevealing(false);}
  }
  async function hint(){
    const count=Math.min((question.hints??[]).length,(hintCounts[question.position]??0)+1);const next={...hintCounts,[question.position]:count};
    try{await persist(answers,checkpointed,sessionRevision,next);setHintCounts(next);void recordActivity(api,session.id,question.position,"hint",count);}catch{setError("提示记录无法保存，请重试。");}
  }
  async function study(){
    if(!studyQuestion)return;const next=new Set(learned).add(studyQuestion.position);
    try{await persist(answers,checkpointed,sessionRevision,hintCounts,next);setLearned(next);void recordActivity(api,session.id,studyQuestion.position,"study");}catch{setError("学习卡记录无法保存，请重试。");}
  }
  async function submit(){
    if(!allRevealed||submitting||syncingRef.current||conflicts.length)return;setSubmitting(true);setError(null);
    try{
      await syncPendingActivities(api);
      const frozenRows=await Promise.all(orderedAnswers.map(async answer=>{const target=questions.find(q=>q.position===answer.position)!;return{position:answer.position,questionId:target.id,answer:answer.answer,revision:answer.revision,answerHash:await sha256Jsonb({questionId:target.id,answer:answer.answer,revision:answer.revision})};}));
      const result=await api.submitSession({sessionId:session.id,answers:orderedAnswers.filter(answer=>!checkpointed.has(answer.position)),sessionRevision,idempotencyKey:submitKey.current,frozenHash:await sha256Jsonb(frozenRows)});
      await clearRecovery(session.id);onSubmitted(result.submissionId);
    }catch(caught){setError((caught instanceof Error?caught.message:"提交未完成")+"。请重试；若其他设备已修改，请返回首页重新打开。");}
    finally{setSubmitting(false);}
  }
  async function useCloud(){try{await persist();setConflicts([]);}catch{setError("无法保存选择，请重试。");}}
  if(restoring)return <main className="center-state">正在恢复已保存答案…</main>;
  return <main className="review-shell"><header className="review-header"><button className="icon-button" onClick={onClose} aria-label="返回首页">←</button><div><p className="eyebrow">{bootstrap.learningDate}</p><strong>{answeredCount} / {questions.length}</strong></div><span className="sync-pill">{syncing?"正在保存":`${checkpointed.size} 题已同步`}</span></header><div className="progress-track"><span style={{width:`${Math.round(answeredCount/questions.length*100)}%`}}/></div>{conflicts.length?<section className="question-stage"><h1>发现两个设备的答案不同</h1><p>请先保留下面的本机答案，再选择继续使用云端记录。</p>{conflicts.map(answer=><article key={answer.position}><h2>第 {answer.position} 题</h2><p>本机：{answer.answer}</p><p>云端：{answers.get(answer.position)?.answer??"该位置已调整"}</p><textarea aria-label={`第 ${answer.position} 题本机答案`} value={answer.answer} readOnly/></article>)}<button className="primary-button" onClick={()=>void useCloud()}>使用云端记录继续</button></section>:studyQuestion?<section className="question-stage learning-card"><p className="eyebrow">先熟悉这个表达</p><h1>{studyQuestion.learningCard?.expression??studyQuestion.expectedAnswers[0]}</h1><p>{studyQuestion.learningCard!.meaningZh}</p><blockquote>{studyQuestion.learningCard!.example}</blockquote><p>{studyQuestion.learningCard!.usageNote}</p><button className="primary-button" onClick={()=>void study()}>我已看过，隐藏学习卡</button><p className="muted">接下来会隐藏内容进行提取。今天刚学后的答对不作为跨日掌握证据。</p></section>:<><section className="question-stage"><div className="question-number">{String(index+1).padStart(2,"0")}</div><p className="question-type">{({contextual_gap:"搭配填空",collocation_gap:"搭配填空",whole_recall:"完整词块回忆",collocation_recall:"词块回忆",short_expression:"情境表达",transfer_expression:"换情境运用",learning_recall:"初次提取"} as Record<string,string>)[question.questionType??""]??"词块练习"}</p><h1>{question.promptZh||question.promptEn}</h1>{question.promptZh&&question.promptEn&&<p className="prompt-en">{question.promptEn}</p>}{safeBoundary&&<p className="semantic-boundary">{safeBoundary}</p>}{!isRevealed&&(question.hints?.length??0)>0&&<div className="hint-box">{question.hints!.slice(0,hintCounts[question.position]??0).map((text,i)=><p key={i}>{text}</p>)}{(hintCounts[question.position]??0)<question.hints!.length&&<button className="quiet-button" onClick={()=>void hint()}>需要提示</button>}</div>}<label className="answer-field"><span>你的答案</span><textarea value={input} onChange={event=>setInput(event.target.value)} disabled={isRevealed||revealing} placeholder={["short_expression","transfer_expression"].includes(question.questionType??"")?"写一两句回应…":"在这里写下完整搭配…"} autoFocus/></label>{!isRevealed?<button className="primary-button" onClick={()=>void reveal()} disabled={!input.trim()||revealing||syncing}>{revealing?"保存中…":"查看答案"}</button>:<div className="answer-reveal" data-testid="answer-reveal"><p className="eyebrow">参考表达</p><strong>{question.expectedAnswers[0]}</strong>{question.acceptedVariants.length>0&&<p>也接受：{question.acceptedVariants.join(" · ")}</p>}</div>}</section><footer className="review-footer"><button className="secondary-button" onClick={()=>setIndex(current=>Math.max(0,current-1))} disabled={index===0}>上一题</button>{index<questions.length-1?<button className="secondary-button" onClick={()=>setIndex(current=>current+1)} disabled={!isRevealed||syncing}>下一题</button>:<button className="primary-button" onClick={()=>void submit()} disabled={!allRevealed||submitting||syncing}>{submitting?"正在提交…":"提交本次学习"}</button>}</footer></>}{error&&<div className="review-error"><p className="inline-error" role="alert">{error}</p>{answers.size>checkpointed.size&&<button className="secondary-button" onClick={()=>void checkpoint(orderedAnswers.filter(answer=>!checkpointed.has(answer.position)),answers)} disabled={syncing||conflicts.length>0}>重试同步</button>}</div>}</main>;
}
