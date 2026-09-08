import { ArrowRight, Check, CircleAlert, Cloud, Database, History, LockKeyhole, RefreshCw, ShieldCheck, Smartphone, Sparkles } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ApiClient, LegacyRecovery, ReviewBootstrap, SystemStatus } from "../lib/contracts";
import { makeIdempotencyKey } from "../lib/hash";
import { loadRecovery, syncPendingActivities } from "../lib/recovery";
import { PasswordForm } from "./PasswordForm";
import { PageHeading } from "./PageHeading";
import { AiJobPanel } from "./AiJobPanel";

export function QuestionCountSettings({client,demo,onChanged}: {client:ApiClient;demo:boolean;onChanged():Promise<void>}) {
  const [bootstrap,setBootstrap] = useState<ReviewBootstrap|null>(null);
  const [count,setCount] = useState(12);
  const [mode,setMode] = useState<"today"|"default"|"both">("today");
  const [localMinimum,setLocalMinimum] = useState(1);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState<string|null>(null);
  const key=useRef(makeIdempotencyKey("question-count"));
  const refresh=useCallback(async()=>{
    const results=await Promise.allSettled([client.getReviewBootstrap()]);
    if(results[0].status === "fulfilled") {
      const next=results[0].value;setBootstrap(next);setCount(next.settings?.todayQuestionCount ?? next.session?.maxQuestions ?? 12);
      if(next.session){const recovery=await loadRecovery(next.session.id);setLocalMinimum(Math.max(1,...(recovery?.answers.map(answer=>answer.position)??[])));}
    }
    const error=results.find(result=>result.status==="rejected");if(error?.status==="rejected")setMessage(error.reason instanceof Error?error.reason.message:"设置加载失败。");
  },[client]);
  useEffect(()=>{void refresh();},[refresh]);
  const minimum=Math.max(localMinimum,bootstrap?.settings?.minimumTodayCount??1);
  const frozen=Boolean(bootstrap?.session?.submissionId)||["submitted","grading","needs_confirmation","committed"].includes(bootstrap?.state??"");
  async function save(event:FormEvent){
    event.preventDefault();setBusy(true);setMessage(null);
    try{
      if(!Number.isInteger(count)||count<1||count>150)throw new Error("题量必须为 1–150 的整数。");
      if(mode!=="default"&&count<minimum)throw new Error(`今天已有锁定题目，最少需保留 ${minimum} 个位置。`);
      if(mode!=="default"&&frozen)throw new Error("今天的批次已提交，请选择以后默认。");
      if(!demo&&mode!=="default")await syncPendingActivities(client);
      const result=await client.setQuestionCount(count,mode,bootstrap?.settings?.revision??bootstrap?.session?.revision??null,key.current);
      key.current=makeIdempotencyKey("question-count");await refresh();await onChanged();
      setMessage(`设置已保存。${mode!=="default"?`今天实际安排 ${result.actualCount??result.count} 题。`:"以后默认已更新。"}已作答内容保留；素材不足时不会凑题。`);
    }catch(caught){setMessage(caught instanceof Error?caught.message:"设置未更新，请刷新后重试。");if(String(caught).includes("REVISION")){key.current=makeIdempotencyKey("question-count");await refresh();}}
    finally{setBusy(false);}
  }
  return <section className="card settings-card"><h2>每日题量</h2><p>当前默认 {bootstrap?.settings?.defaultQuestionCount??"…"} 题 · 今日可调整下限 {minimum} 题</p><form onSubmit={save}><label>题量<input type="number" min={mode==="default"?1:minimum} max={150} step={1} required value={count} onChange={event=>{setCount(Number(event.target.value));key.current=makeIdempotencyKey("question-count");}} /></label><fieldset><legend>生效范围</legend>{([["today","仅今天"],["default","以后默认"],["both","今天和以后"]] as const).map(([value,label])=><label className="radio-label" key={value}><input type="radio" name="question-mode" checked={mode===value} value={value} onChange={()=>{setMode(value);key.current=makeIdempotencyKey("question-count");}} disabled={frozen&&value!=="default"}/>{label}</label>)}</fieldset>{frozen&&<p>今天的批次已提交，仍可修改以后默认题量。</p>}<button className="primary-button" disabled={busy||!bootstrap||(frozen&&mode!=="default")}>{busy?"正在保存…":"保存题量"}</button></form>{message&&<p role="status" className="job-message">{message}</p>}</section>;
}

export function SettingsView({client,demo,onSignOut,onChanged}: {client:ApiClient;demo:boolean;onSignOut():Promise<void>;onChanged():Promise<void>}) {
  const [status,setStatus] = useState<SystemStatus|null>(null);
  const [legacy,setLegacy] = useState<LegacyRecovery|null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string|null>(null);
  const [passwordPage,setPasswordPage] = useState(false);
  const load = useCallback(async()=>{setBusy(true);setError(null);try{setStatus(await client.getSystemStatus());}catch(caught){setError(caught instanceof Error?caught.message:"暂时无法确认同步状态。");}finally{setBusy(false);}},[client]);
  useEffect(()=>{void load();},[load]);
  async function loadLegacy(){setBusy(true);try{setLegacy(await client.getLegacyRecovery());}catch(caught){setError(caught instanceof Error?caught.message:"旧记录读取失败。");}finally{setBusy(false);}}
  if(passwordPage) return <section className="page-stack password-change-view"><button className="text-button" onClick={()=>setPasswordPage(false)}>← 返回同步与设置</button><PageHeading eyebrow="账号安全" title="修改登录密码" description="为这个学习空间设置新的登录密码。"/><PasswordForm demo={demo}/></section>;
  return <section className="page-stack view-enter">
    <PageHeading eyebrow="安心保存，随时继续" title="同步与设置" description="查看同步状态，调整学习量，管理你的学习空间。" action={<button className="icon-button" aria-label="刷新同步状态" onClick={()=>void load()} disabled={busy}><RefreshCw size={19} className={busy?"spin":""}/></button>}/>
    {error&&<p className="inline-error" role="alert">{error}</p>}
    <article className="status-hero card"><div className="status-hero__icon"><ShieldCheck/></div><div><span>学习空间状态</span><h2>{status?.ok ? "学习空间连接正常" : busy ? "正在确认连接…" : "连接需要检查"}</h2><p>{demo?"演示模式":"个人学习空间"}</p></div>{status?.ok&&<span className="status-check"><Check size={17}/>连接正常</span>}</article>
    <div className="status-grid">
      <StatusCard icon={<Database/>} title="云端数据" value={status ? (demo?"演示数据":status.ok?"最近连接成功":"连接异常") : "尚未确认"} note="语料、题目与学习记录" ok={Boolean(status?.ok)}/>
      <StatusCard icon={<Cloud/>} title="AI 处理" value={status ? `${status.pendingAiJobs} 项等待处理` : "正在读取"} note="发一句指令给 ChatGPT 即可继续" ok={Boolean(status)}/>
      <StatusCard icon={<Smartphone/>} title="提交状态" value={status?status.failedSubmissions?`${status.failedSubmissions} 项需要重试`:"没有失败的提交":"正在读取"} note="作答中的恢复草稿保存在当前设备" ok={Boolean(status)&&status?.failedSubmissions===0}/>
      <StatusCard icon={<History/>} title="最近完成学习" value={status?.lastCommittedAt?new Date(status.lastCommittedAt).toLocaleDateString("zh-CN"):"暂无记录"} note="以最终保存的学习结果为准" ok={Boolean(status)}/>
    </div>
    <QuestionCountSettings client={client} demo={demo} onChanged={onChanged}/>
    <article className="card account-security-card"><div className="section-title"><div><span>账号安全</span><p>在当前登录状态下修改密码。</p></div><LockKeyhole size={21}/></div><button className="secondary-button" onClick={()=>setPasswordPage(true)}>修改密码<ArrowRight size={17}/></button></article>
    <MaterialGenerator client={client}/>
    <article className="card settings-card"><div className="section-title"><div><span>历史与恢复</span><p>旧草稿和历史记录，可以在需要时查阅。</p></div><button className="secondary-button" onClick={()=>void loadLegacy()} disabled={busy}>查看旧记录</button></div>{legacy&&<div className="legacy-records">{legacy.items.length?legacy.items.map(item=><details key={item.id}><summary>{item.source} · {item.createdAt?new Date(item.createdAt).toLocaleDateString("zh-CN"):"历史记录"}</summary><pre>{JSON.stringify(item.content,null,2)}</pre></details>):<p className="empty-inline">没有待恢复的旧草稿。</p>}</div>}</article>
    {!demo&&<button className="text-button" onClick={()=>void onSignOut()}>退出登录</button>}
  </section>;
}
function StatusCard({icon,title,value,note,ok}: {icon:ReactNode;title:string;value:string;note:string;ok:boolean}) {
  return <article className="status-card card"><div className={`status-card__icon ${ok?"":"is-error"}`}>{icon}</div><div><span>{title}</span><strong>{value}</strong><small>{note}</small></div>{ok?<Check className="status-card__mark" size={18}/>:<CircleAlert className="status-card__mark is-error" size={18}/>}</article>;
}
function MaterialGenerator({client}: {client:ApiClient}) {
  const [count,setCount]=useState(2);
  return <article className="card settings-card material-generator"><div className="section-title"><div><span>补充学习素材</span><p>生成后到学习资料库确认，不会改变今天的题量。</p></div><Sparkles size={21}/></div><label className="material-count">希望补充的候选数<input type="number" min={1} max={20} step={1} value={count} onChange={event=>setCount(Math.max(1,Math.min(20,Math.round(Number(event.target.value)))))}/></label><AiJobPanel api={client} kind="candidate_generate" requestedCount={count}/></article>;
}
