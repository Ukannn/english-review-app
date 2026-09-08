import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { ApiClient, LegacyRecovery, ReviewBootstrap, SystemStatus } from "../lib/contracts";
import { makeIdempotencyKey } from "../lib/hash";
import { loadRecovery, syncPendingActivities } from "../lib/recovery";
import { PasswordForm } from "./PasswordForm";

export function SettingsView({client,demo,onSignOut,onChanged}: {client:ApiClient;demo:boolean;onSignOut():Promise<void>;onChanged():Promise<void>}) {
  const [bootstrap,setBootstrap] = useState<ReviewBootstrap|null>(null);
  const [status,setStatus] = useState<SystemStatus|null>(null);
  const [legacy,setLegacy] = useState<LegacyRecovery|null>(null);
  const [count,setCount] = useState(12);
  const [mode,setMode] = useState<"today"|"default"|"both">("today");
  const [localMinimum,setLocalMinimum] = useState(1);
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState<string|null>(null);
  const key=useRef(makeIdempotencyKey("question-count"));
  const refresh=useCallback(async()=>{
    const results=await Promise.allSettled([client.getReviewBootstrap(),client.getSystemStatus()]);
    if(results[0].status === "fulfilled") {
      const next=results[0].value;setBootstrap(next);setCount(next.settings?.todayQuestionCount ?? next.session?.maxQuestions ?? 12);
      if(next.session){const recovery=await loadRecovery(next.session.id);setLocalMinimum(Math.max(1,...(recovery?.answers.map(answer=>answer.position)??[])));}
    }
    if(results[1].status === "fulfilled")setStatus(results[1].value);
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
  async function loadLegacy(){setBusy(true);try{setLegacy(await client.getLegacyRecovery());}catch(caught){setMessage(caught instanceof Error?caught.message:"旧记录读取失败。");}finally{setBusy(false);}}
  return <main className="section-content"><section className="section-intro"><h1>设置</h1><p>题量可以随时调整，已完成的作答会保留。</p></section><div className="page-stack"><section className="glass-card settings-card"><h2>每日题量</h2><p>当前默认 {bootstrap?.settings?.defaultQuestionCount??"…"} 题 · 今日可调整下限 {minimum} 题</p><form onSubmit={save}><label>题量<input type="number" min={mode==="default"?1:minimum} max={150} step={1} required value={count} onChange={event=>{setCount(Number(event.target.value));key.current=makeIdempotencyKey("question-count");}} /></label><fieldset><legend>生效范围</legend>{([["today","仅今天"],["default","以后默认"],["both","今天和以后"]] as const).map(([value,label])=><label className="radio-label" key={value}><input type="radio" name="question-mode" checked={mode===value} value={value} onChange={()=>{setMode(value);key.current=makeIdempotencyKey("question-count");}} disabled={frozen&&value!=="default"}/>{label}</label>)}</fieldset>{frozen&&<p>今天的批次已提交，仍可修改以后默认题量。</p>}<button className="primary-button" disabled={busy||!bootstrap||(frozen&&mode!=="default")}>{busy?"正在保存…":"保存题量"}</button></form></section><PasswordForm demo={demo}/><section className="glass-card settings-card"><h2>同步与历史资料</h2><p>{status?"最近一次连接成功":"尚未确认连接"}</p><dl><div><dt>待处理 AI 任务</dt><dd>{status?.pendingAiJobs??"—"}</dd></div><div><dt>需重试的提交</dt><dd>{status?.failedSubmissions??"—"}</dd></div><div><dt>最近完成学习</dt><dd>{status?.lastCommittedAt?new Date(status.lastCommittedAt).toLocaleString("zh-CN"):"暂无"}</dd></div></dl><button className="secondary-button" onClick={()=>void loadLegacy()} disabled={busy}>查看旧草稿与恢复记录</button>{legacy&&<div className="legacy-records">{legacy.items.length?legacy.items.map(item=><details key={item.id}><summary>{item.source} · {item.status} · {item.createdAt?new Date(item.createdAt).toLocaleDateString("zh-CN"):"历史记录"}</summary><pre>{JSON.stringify(item.content,null,2)}</pre></details>):<p>没有待恢复的旧草稿。</p>}<p className="muted">旧答案可查阅、复制，不会自动恢复为新规则下的学习批次。</p></div>}</section>{message&&<p role="status">{message}</p>}{!demo&&<button className="secondary-button" onClick={()=>void onSignOut()}>退出登录并清理本机学习缓存</button>}</div></main>;
}
