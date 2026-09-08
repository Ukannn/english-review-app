import { BookOpen, Check, ChevronRight, Edit3, ExternalLink, Inbox, Search, Sparkles, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient, CandidateBootstrap, CandidateItem, ContextInbox, PhraseDetail, PhraseLibrary } from "../lib/contracts";
import { makeIdempotencyKey } from "../lib/hash";
import { AiJobPanel } from "./AiJobPanel";
import { PageHeading } from "./PageHeading";

export function LibraryWorkspace({client,onGenerate}: {client:ApiClient;onGenerate():void}) {
  const [tab,setTab]=useState<"library"|"candidates">("library");
  return <section className="page-stack view-enter">
    <PageHeading eyebrow="把表达慢慢变成自己的" title="学习资料库" description="查阅表达、复习记录，以及等待你确认的新素材。" action={<div className="heading-icon"><BookOpen/></div>}/>
    <div className="inbox-toolbar"><div className="segmented-control" aria-label="资料库分类"><button className={tab==="library"?"is-active":""} aria-pressed={tab==="library"} onClick={()=>setTab("library")}>已收录表达</button><button className={tab==="candidates"?"is-active":""} aria-pressed={tab==="candidates"} onClick={()=>setTab("candidates")}>待确认候选</button></div><button className="text-button" onClick={onGenerate}><Sparkles size={16}/>补充学习素材</button></div>
    {tab==="library"?<PhraseView client={client}/>:<CandidateView client={client}/>}
  </section>;
}
export function PhraseView({client}: {client:ApiClient}) {
  const [search,setSearch]=useState("");const [data,setData]=useState<PhraseLibrary|null>(null);const [detail,setDetail]=useState<PhraseDetail|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState<string|null>(null);
  const request=useRef(0);
  async function load(offset=0){const version=++request.current;setBusy(true);setError(null);try{const next=await client.getPhraseLibrary(search||null,100,offset);if(version===request.current)setData(current=>offset?{...next,items:[...(current?.items??[]),...next.items]}:next);}catch(caught){if(version===request.current)setError(caught instanceof Error?caught.message:"表达加载失败。");}finally{if(version===request.current)setBusy(false);}}
  useEffect(()=>{void load();return()=>{request.current+=1;};},[client]);
  async function open(id:string){const version=++request.current;setBusy(true);setError(null);try{const next=await client.getPhraseDetail(id);if(version===request.current)setDetail(next);}catch(caught){if(version===request.current)setError(caught instanceof Error?caught.message:"详情加载失败。");}finally{if(version===request.current)setBusy(false);}}
  return <div className="page-stack">
    <form className="library-toolbar card" onSubmit={event=>{event.preventDefault();void load();}}><label className="search-field"><Search size={18}/><input aria-label="搜索表达" value={search} onChange={event=>setSearch(event.target.value)} placeholder="搜索表达、中文提示或主题"/></label><button className="secondary-button" disabled={busy}>{busy?"读取中…":"搜索"}</button></form>
    {error&&<p className="inline-error" role="alert">{error}</p>}
    <div className="library-list card">{data?.items.map(item=><article className="library-row" key={item.id}><button className="library-row__open" onClick={()=>void open(item.id)} disabled={busy}><div className="item-monogram" aria-hidden="true">{item.chunk.charAt(0).toUpperCase()}</div><div><strong className="expression-display" lang="en">{item.chunk}</strong><span>{item.cueZh}</span><small>练习 {item.timesSeen} 次 · 复习阶段 {item.reviewStage}</small></div><div className="library-row__right"><time>{item.nextReviewAt?new Date(item.nextReviewAt).toLocaleDateString("zh-CN"):"待安排"}</time><ChevronRight size={18}/></div></button></article>)}{data?.items.length===0&&<div className="empty-state"><BookOpen size={30}/><h2>这里还没有表达</h2><p>{search?"换个关键词再找找。":"从一段真实语料开始，逐渐建立自己的表达库。"}</p></div>}{!data&&!error&&<p className="empty-inline">正在读取学习资料…</p>}</div>
    {data&&data.items.length>0&&data.items.length%100===0&&<button className="secondary-button" onClick={()=>void load(data.items.length)} disabled={busy}>加载更多</button>}
    {detail&&<PhraseDetailSheet detail={detail} onClose={()=>setDetail(null)}/>}
  </div>;
}
function PhraseDetailSheet({detail,onClose}: {detail:PhraseDetail;onClose():void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{dialog.current?.showModal();return()=>dialog.current?.close();},[]);
  return <dialog ref={dialog} className="detail-sheet" aria-label={`${detail.phrase.chunk} 的学习详情`} onCancel={onClose} onClose={onClose} onClick={event=>{if(event.target===event.currentTarget){const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right)onClose();}}}>
    <header><span className="status-chip">学习详情</span><button className="icon-button" aria-label="关闭表达详情" onClick={onClose}><X size={19}/></button></header>
    <div className="detail-title"><div><h2 className="expression-display" lang="en">{detail.phrase.chunk}</h2><p>{detail.phrase.cueZh}</p></div></div>
    <dl><div><dt>复习阶段</dt><dd>{detail.phrase.reviewStage}</dd></div><div><dt>下次复习</dt><dd>{detail.phrase.nextReviewAt?new Date(detail.phrase.nextReviewAt).toLocaleDateString("zh-CN"):"待安排"}</dd></div><div><dt>练习次数</dt><dd>{detail.phrase.timesSeen}</dd></div></dl>
    {detail.phrase.naturalExample&&<div className="detail-example"><span lang="en">{detail.phrase.naturalExample}</span></div>}
    {detail.phrase.commonMistake&&<div className="detail-forms"><h3>使用提醒</h3><p>{detail.phrase.commonMistake}</p></div>}{detail.phrase.notes&&<p>{detail.phrase.notes}</p>}
    <div className="detail-forms"><h3>练习历史</h3>{detail.history.length?detail.history.map((item,index)=><article className="history-item" key={`${item.reviewedAt}:${index}`}><small>{new Date(item.reviewedAt).toLocaleDateString("zh-CN")}</small><p>{item.prompt}</p><p>你的答案：{item.userAnswer??"无记录"}</p><p>参考：{item.expectedAnswer??"无记录"}</p></article>):<p className="muted">暂无练习历史。</p>}</div>
  </dialog>;
}

const pendingDecision=(status:string)=>["staged","pending","proposed","ready","generated","unreviewed"].includes(status);
export function ContextView({client}: {client:ApiClient}) {
  const [data,setData]=useState<ContextInbox|null>(null);const [rawText,setRawText]=useState("");const [note,setNote]=useState("");const [sourceUrl,setSourceUrl]=useState("");const [busy,setBusy]=useState(false);const [message,setMessage]=useState<string|null>(null);const [selected,setSelected]=useState<string|null>(null);const [tab,setTab]=useState<"pending"|"review"|"archived">("pending");
  const refresh=useCallback(async()=>{try{setData(await client.getContextInbox());}catch(caught){setMessage(caught instanceof Error?caught.message:"语料读取失败。");}},[client]);
  useEffect(()=>{void refresh();},[refresh]);
  async function submit(event:FormEvent){event.preventDefault();setBusy(true);setMessage(null);try{await client.saveContext({rawText:rawText.trim(),userNote:note.trim(),sourceUrl:sourceUrl.trim()||null,selectedSpans:[]},null,makeIdempotencyKey("context"));setRawText("");setNote("");setSourceUrl("");setTab("pending");await refresh();setMessage("语料已保存，可以交给 ChatGPT 整理。");}catch(caught){setMessage(caught instanceof Error?caught.message:"保存失败。");}finally{setBusy(false);}}
  async function decide(id:string,action:"accept"|"edit"|"reject",edited:string|null){setBusy(true);try{await client.decideContextCandidate(id,action,edited,makeIdempotencyKey(`context-candidate:${id}`));await refresh();}catch(caught){setMessage(caught instanceof Error?caught.message:"处理失败。");}finally{setBusy(false);}}
  const category=(context:ContextInbox["contexts"][number])=>context.candidates.some(candidate=>pendingDecision(candidate.decisionStatus))?"review":["pending","processing"].includes(context.status)?"pending":"archived";
  const contexts=data?.contexts??[];
  return <section className="page-stack view-enter">
    <PageHeading eyebrow="从真实语境开始" title="语料" description="留下阅读、工作与对话中，你真正想用的英语。" action={<div className="heading-icon heading-icon--red"><Inbox/></div>}/>
    <form className="context-form card" onSubmit={submit}><div className="section-title"><div><span>添加一段原文</span><p>原文和使用场景会一起保留，供后续整理与复习。</p></div></div><label>原文<textarea value={rawText} onChange={event=>setRawText(event.target.value)} required placeholder="粘贴遇到的英语句子、对话或段落…" rows={5}/></label><div className="form-grid"><label>来源链接（可选）<input type="url" value={sourceUrl} onChange={event=>setSourceUrl(event.target.value)} placeholder="https://"/></label><label>想表达什么（可选）<input value={note} onChange={event=>setNote(event.target.value)} placeholder="记录场景或想学会它的原因"/></label></div><div className="form-footer"><span>{rawText.length.toLocaleString()} 个字符</span><button className="primary-button" disabled={busy||!rawText.trim()}><Check size={17}/>保存语料</button></div></form>
    {message&&<p role="status" className="job-message">{message}</p>}
    <div className="inbox-toolbar"><div className="segmented-control" aria-label="语料状态">{([["pending","待整理"],["review","待确认"],["archived","已归档"]] as const).map(([value,label])=><button key={value} className={tab===value?"is-active":""} aria-pressed={tab===value} onClick={()=>setTab(value)}>{label}<span>{contexts.filter(context=>category(context)===value).length}</span></button>)}</div></div>
    <div className="context-list">{contexts.filter(context=>category(context)===tab).map(context=><article key={context.id} className="context-card card"><header><div><span className={`status-chip status-chip--${context.status}`}>{category(context)==="pending"?"等待整理":category(context)==="review"?"等待确认":"已归档"}</span><time>{new Date(context.createdAt).toLocaleDateString("zh-CN")}</time></div>{context.sourceUrl&&<a href={context.sourceUrl} target="_blank" rel="noreferrer" aria-label="查看原文链接"><ExternalLink size={17}/></a>}</header><p className="context-text" lang="en">{context.rawText}</p>{context.userNote&&<p className="context-note">{context.userNote}</p>}{category(context)==="pending"&&<button className="secondary-button" onClick={()=>setSelected(selected===context.id?null:context.id)}><Sparkles size={17}/>整理这段语料</button>}{selected===context.id&&<AiJobPanel api={client} kind="context_extract" subjectId={context.id} onImported={async()=>{await refresh();setTab("review");setSelected(null);}}/>}<div className="candidate-list">{context.candidates.map(candidate=><CandidateEditor key={candidate.id} item={{id:candidate.id,source:"context",candidate:candidate.candidate,cueZh:candidate.cueZh,whyUseful:candidate.whyUseful,naturalExample:null,status:candidate.decisionStatus}} busy={busy} decide={(action,edited)=>decide(candidate.id,action,edited??null)}/>)}</div></article>)}{data&&contexts.filter(context=>category(context)===tab).length===0&&<div className="empty-state card"><Inbox size={30}/><h2>{tab==="pending"?"没有待整理的语料":tab==="review"?"没有待确认的表达":"还没有归档语料"}</h2><p>{tab==="pending"?"把遇到的一句话留下来，慢慢积累自己的素材。":"整理与确认后的语料会保留在这里。"}</p></div>}{!data&&<p className="empty-inline">正在读取语料…</p>}</div>
  </section>;
}
export function CandidateView({client}: {client:ApiClient}) {
  const [data,setData]=useState<CandidateBootstrap|null>(null);const [message,setMessage]=useState<string|null>(null);const [busy,setBusy]=useState(false);
  const refresh=useCallback(async()=>{try{setData(await client.getCandidateBootstrap());}catch(caught){setMessage(caught instanceof Error?caught.message:"候选读取失败。");}},[client]);useEffect(()=>{void refresh();},[refresh]);
  async function decide(item:CandidateItem,action:"accept"|"edit"|"reject",editedCandidate?:string){setBusy(true);try{await client.confirmCandidates([{id:item.id,source:item.source,action,editedCandidate}],makeIdempotencyKey(`candidate:${item.id}`));await refresh();}catch(caught){setMessage(caught instanceof Error?caught.message:"处理失败。");}finally{setBusy(false);}}
  return <div className="page-stack"><div className="session-summary"><span>新表达经你确认后进入学习</span>{data&&<span className="summary-sync">已确认、等待安排 {data.readyCount} 项</span>}</div>{message&&<p className="job-message" role="status">{message}</p>}<div className="candidate-list">{data?.items.map(item=><CandidateEditor key={item.id} item={item} busy={busy} decide={(action,edited)=>decide(item,action,edited)}/>)}</div>{data?.items.length===0&&<div className="empty-state card"><Check size={30}/><h2>候选都确认好了</h2><p>可以添加自己的语料，也可以到同步与设置中补充学习素材。</p></div>}</div>;
}
function CandidateEditor({item,busy,decide}: {item:CandidateItem;busy:boolean;decide(action:"accept"|"edit"|"reject",edited?:string):Promise<void>}) {
  const [editing,setEditing]=useState(false);const [edited,setEdited]=useState(item.candidate);const pending=pendingDecision(item.status);
  return <article className="proposal-card"><div className="proposal-top"><div><span className="type-chip">{item.source==="context"?"我的语料":"推荐素材"}</span><strong className="expression-display" lang="en">{item.candidate}</strong></div></div><h3>{item.cueZh}</h3><p>{item.whyUseful}</p>{item.naturalExample&&<blockquote className="example-pair" lang="en">{item.naturalExample}</blockquote>}{pending?<>{editing&&<label className="proposal-editor">修改表达<input value={edited} onChange={event=>setEdited(event.target.value)}/></label>}<div className="proposal-actions"><button className="secondary-button" disabled={busy} onClick={()=>void decide("reject")}><X size={16}/>跳过</button><button className="secondary-button" disabled={busy} onClick={()=>setEditing(!editing)}><Edit3 size={16}/>{editing?"取消编辑":"编辑"}</button><button className="primary-button" disabled={busy||!edited.trim()} onClick={()=>void decide(editing?"edit":"accept",editing?edited.trim():undefined)}><Check size={16}/>{editing?"保存修改并接受":"收进学习资料库"}</button></div></>:<span className="decision-label"><Check size={16}/>{["rejected","reject"].includes(item.status)?"已跳过":"已处理"}</span>}</article>;
}
