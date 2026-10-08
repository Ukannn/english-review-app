import { BookOpen, Check, ChevronRight, Edit3, ExternalLink, Inbox, Search, Sparkles, X } from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient, CandidateBootstrap, CandidateItem, ContextInbox, PhraseDetail, PhraseLibrary } from "../lib/contracts";
import { makeIdempotencyKey } from "../lib/hash";
import { ContextBatchPanel } from "./ContextBatchPanel";
import { PageHeading } from "./PageHeading";
import { SegmentedControl } from "./SegmentedControl";
import { useAnimatedDialog } from "../lib/useAnimatedDialog";
import { formatLearningDate, formatLearningTime } from "../lib/learningDate";

export function LibraryWorkspace({client,onGenerate,onIntake}: {client:ApiClient;onGenerate():void;onIntake?():void}) {
  const [tab,setTab]=useState<"library"|"candidates">("library");
  return <section className="page-stack view-enter">
    <PageHeading eyebrow="把表达慢慢变成自己的" title="学习资料库" description="查阅表达、复习记录，以及等待你确认的新素材。" action={<div className="heading-icon"><BookOpen/></div>}/>
    <div className="inbox-toolbar"><SegmentedControl label="资料库分类"><button className={tab==="library"?"is-active":""} aria-pressed={tab==="library"} onClick={()=>setTab("library")}>已收录表达</button><button className={tab==="candidates"?"is-active":""} aria-pressed={tab==="candidates"} onClick={()=>setTab("candidates")}>待确认候选</button></SegmentedControl><div className="button-row">{onIntake&&<button className="secondary-button" onClick={onIntake}><Inbox size={16}/>语料与来源</button>}<button className="text-button" onClick={onGenerate}><Sparkles size={16}/>补充学习素材</button></div></div>
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
    <form className="library-toolbar card" onSubmit={event=>{event.preventDefault();void load();}}><label className="search-field"><Search size={18}/><input aria-label="搜索表达" value={search} onChange={event=>setSearch(event.target.value)} placeholder="搜索表达或中文提示"/></label><button className="secondary-button" disabled={busy}>{busy?"读取中…":"搜索"}</button></form>
    {error&&<p className="inline-error" role="alert">{error}</p>}
    <div className="library-list card">{data?.items.map(item=><article className="library-row" key={item.id}><button className="library-row__open" onClick={()=>void open(item.id)} disabled={busy}><div className="item-monogram" aria-hidden="true">{item.chunk.charAt(0).toUpperCase()}</div><div><strong className="expression-display" lang="en">{item.chunk}</strong><span>{item.cueZh}</span><small>练习 {item.timesSeen} 次 · 复习阶段 {item.reviewStage}</small></div><div className="library-row__right"><time>{item.nextReviewAt?formatLearningDate(item.nextReviewAt):"待安排"}</time><ChevronRight size={18}/></div></button></article>)}{data?.items.length===0&&<div className="empty-state"><BookOpen size={30}/><h2>这里还没有表达</h2><p>{search?"换个关键词再找找。":"从一段真实语料开始，逐渐建立自己的表达库。"}</p></div>}{!data&&!error&&<p className="empty-inline">正在读取学习资料…</p>}</div>
    {data&&data.items.length>0&&data.items.length%100===0&&<button className="secondary-button" onClick={()=>void load(data.items.length)} disabled={busy}>加载更多</button>}
    {detail&&<PhraseDetailSheet detail={detail} onClose={()=>setDetail(null)}/>}
  </div>;
}
export function PhraseDetailSheet({detail,onClose}: {detail:PhraseDetail;onClose():void}) {
  const { dialog, requestClose, onCancel, onNativeClose } = useAnimatedDialog(onClose);
  return <dialog ref={dialog} data-motion="entering" className="detail-sheet" aria-label={`${detail.phrase.chunk} 的学习详情`} onCancel={onCancel} onClose={onNativeClose} onClick={event=>{if(event.target===event.currentTarget){const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)requestClose();}}}>
    <header><span className="status-chip">学习详情</span><button className="icon-button" aria-label="关闭表达详情" onClick={requestClose}><X size={19}/></button></header>
    <div className="detail-title"><div><h2 className="expression-display" lang="en">{detail.phrase.chunk}</h2><p>{detail.phrase.cueZh}</p></div></div>
    <dl><div><dt>复习阶段</dt><dd>{detail.phrase.reviewStage}</dd></div><div><dt>下次复习</dt><dd>{detail.phrase.nextReviewAt?formatLearningDate(detail.phrase.nextReviewAt):"待安排"}</dd></div><div><dt>练习次数</dt><dd>{detail.stats.timesSeen}</dd></div></dl>
    {detail.phrase.naturalExample&&<div className="detail-example"><span lang="en">{detail.phrase.naturalExample}</span></div>}
    {detail.phrase.commonMistake&&<div className="detail-forms"><h3>使用提醒</h3><p>{detail.phrase.commonMistake}</p></div>}{detail.phrase.notes&&<p>{detail.phrase.notes}</p>}
    <div className="detail-forms"><h3>练习历史</h3>{detail.history.length?detail.history.map((item,index)=><article className="history-item" key={`${item.reviewedAt}:${index}`}><small>{formatLearningTime(item.reviewedAt)}</small><p>{item.prompt}</p><p>你的答案：{item.userAnswer??"无记录"}</p><p>参考：{item.expectedAnswer??"无记录"}</p></article>):<p className="muted">暂无练习历史。</p>}</div>
  </dialog>;
}

const pendingDecision=(status:string)=>["staged","pending","proposed","ready","generated","unreviewed"].includes(status);
type ContextSpan = {text:string;start:number;end:number};
function validContextSpans(rawText:string, values:unknown[]):ContextSpan[] {
  if (!Array.isArray(values)) return [];
  return values.filter((value):value is ContextSpan=>{
    if (!value || typeof value!=="object") return false;
    const span=value as Partial<ContextSpan>;
    return typeof span.start==="number" && Number.isInteger(span.start) && span.start>=0 && typeof span.end==="number" && Number.isInteger(span.end) && span.end>span.start && span.end<=rawText.length && typeof span.text==="string" && rawText.slice(span.start,span.end)===span.text;
  }).sort((a,b)=>a.start-b.start);
}
function MarkedContext({text,spans}: {text:string;spans:ContextSpan[]}) {
  let cursor=0;
  const parts:ReactNode[]=[];
  for(const span of spans){if(span.start<cursor)continue;parts.push(text.slice(cursor,span.start));parts.push(<mark key={`${span.start}:${span.end}`}>{span.text}</mark>);cursor=span.end;}
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}
export function ContextView({client}: {client:ApiClient}) {
  const [data,setData]=useState<ContextInbox|null>(null);const [rawText,setRawText]=useState("");const [spans,setSpans]=useState<ContextSpan[]>([]);const [selectionMessage,setSelectionMessage]=useState<string|null>(null);const textArea=useRef<HTMLTextAreaElement>(null);const [note,setNote]=useState("");const [sourceUrl,setSourceUrl]=useState("");const [busy,setBusy]=useState(false);const [message,setMessage]=useState<string|null>(null);const [tab,setTab]=useState<"pending"|"review"|"archived">("pending");
  const refresh=useCallback(async()=>{try{setData(await client.getContextInbox());}catch(caught){setMessage(caught instanceof Error?caught.message:"语料读取失败。");}},[client]);
  const pendingSave=useRef<{signature:string;key:string}|null>(null),saving=useRef(false);
  useEffect(()=>{void refresh();},[refresh]);
  function addSelection(){
    const field=textArea.current;
    if(!field || field.selectionStart===field.selectionEnd){setSelectionMessage("请先在原文中选中不懂的部分。");return;}
    const start=field.selectionStart,end=field.selectionEnd;
    if(spans.some(span=>start<span.end&&end>span.start)){setSelectionMessage("这段与已有标记重叠，请先移除旧标记。");return;}
    setSpans(current=>[...current,{text:rawText.slice(start,end),start,end}].sort((a,b)=>a.start-b.start));
    setSelectionMessage(null);
    field.setSelectionRange(end,end);
  }
  async function submit(event:FormEvent){
    event.preventDefault();if(saving.current)return;saving.current=true;setBusy(true);setMessage(null);
    const payload={rawText,userNote:note.trim(),sourceUrl:sourceUrl.trim()||null,selectedSpans:spans},signature=JSON.stringify(payload);
    if(pendingSave.current?.signature!==signature)pendingSave.current={signature,key:makeIdempotencyKey("context")};
    try{
      const response=await client.saveContext(payload,null,pendingSave.current.key) as {ok?:boolean;contextId?:string}|null;
      if(!response?.ok||typeof response.contextId!=="string")throw new Error("未收到保存确认，请重试。");
      pendingSave.current=null;setRawText("");setSpans([]);setSelectionMessage(null);setNote("");setSourceUrl("");setTab("pending");await refresh();setMessage("语料已保存，可以交给 ChatGPT 整理。");
    }catch(caught){setMessage(caught instanceof Error?caught.message:"保存失败。");}finally{saving.current=false;setBusy(false);}
  }
  async function decide(id:string,action:"accept"|"edit"|"reject",edited:string|null){setBusy(true);try{await client.decideContextCandidate(id,action,edited,makeIdempotencyKey(`context-candidate:${id}`));await refresh();}catch(caught){setMessage(caught instanceof Error?caught.message:"处理失败。");}finally{setBusy(false);}}
  const category=(context:ContextInbox["contexts"][number])=>context.candidates.some(candidate=>pendingDecision(candidate.decisionStatus))?"review":["pending","processing"].includes(context.status)?"pending":"archived";
  const contexts=data?.contexts??[];
  return <section className="page-stack view-enter">
    <PageHeading eyebrow="从真实语境开始" title="语料" description="留下阅读、工作与对话中，你真正想用的英语。" action={<div className="heading-icon heading-icon--red"><Inbox/></div>}/>
    <form className="context-form card" onSubmit={submit}><div className="section-title"><div><span>添加一段原文</span><p>可以保存一个不懂的单词，也可以粘贴完整原文并标记不懂的部分；有上下文时能更准确地判断含义。</p></div></div><label>原文<textarea ref={textArea} value={rawText} onChange={event=>{setRawText(event.target.value);if(spans.length){setSpans([]);setSelectionMessage("原文已修改，旧标记已清除，请重新选中标记。");}}} required placeholder="输入遇到的英语单词、句子、对话或段落…" rows={5}/></label><div className="context-marking-actions"><button type="button" className="secondary-button" disabled={busy||!rawText.trim()} onClick={addSelection}>标记选中的不懂部分</button>{spans.length>0&&<button type="button" className="text-button" onClick={()=>{setSpans([]);setSelectionMessage(null);}}>清除全部标记</button>}</div>{selectionMessage&&<p className="context-selection-message" role="status">{selectionMessage}</p>}{spans.length>0&&<div className="context-marking-preview"><span>已标记 {spans.length} 处</span><p lang="en"><MarkedContext text={rawText} spans={spans}/></p><div className="span-list">{spans.map(span=><button type="button" key={`${span.start}:${span.end}`} aria-label={`移除标记 ${span.text}`} onClick={()=>setSpans(current=>current.filter(item=>item!==span))}>{span.text}<X size={14}/></button>)}</div></div>}<div className="form-grid"><label>来源链接（可选）<input type="url" value={sourceUrl} onChange={event=>setSourceUrl(event.target.value)} placeholder="https://"/></label><label>想表达什么（可选）<input value={note} onChange={event=>setNote(event.target.value)} placeholder="记录场景或想学会它的原因"/></label></div><div className="form-footer"><span>{rawText.length.toLocaleString()} 个字符</span><button className="primary-button" disabled={busy||!rawText.trim()}><Check size={17}/>保存语料</button></div></form>
    {message&&<p role="status" className="job-message">{message}</p>}
    <div className="inbox-toolbar"><SegmentedControl label="语料状态">{([["pending","待整理"],["review","待确认"],["archived","已归档"]] as const).map(([value,label])=><button key={value} className={tab===value?"is-active":""} aria-pressed={tab===value} onClick={()=>setTab(value)}>{label}<span>{contexts.filter(context=>category(context)===value).length}</span></button>)}</SegmentedControl></div>
    {data&&<ContextBatchPanel api={client} contextIds={contexts.filter(context=>category(context)==="pending").map(context=>context.id)} onRefresh={refresh}/>}
    <div className="context-list">{contexts.filter(context=>category(context)===tab).map(context=><article key={context.id} className="context-card card"><header><div><span className={`status-chip status-chip--${context.status}`}>{category(context)==="pending"?"等待整理":category(context)==="review"?"等待确认":"已归档"}</span><time>{formatLearningDate(context.createdAt)}</time></div>{context.sourceUrl&&<a href={context.sourceUrl} target="_blank" rel="noreferrer" aria-label="查看原文链接"><ExternalLink size={17}/></a>}</header><p className="context-text" lang="en"><MarkedContext text={context.rawText} spans={validContextSpans(context.rawText,context.selectedSpans)}/></p>{context.userNote&&<p className="context-note">{context.userNote}</p>}<div className="candidate-list">{context.candidates.map(candidate=><CandidateEditor key={candidate.id} item={{id:candidate.id,source:"context",candidate:candidate.candidate,cueZh:candidate.cueZh,whyUseful:candidate.whyUseful,naturalExample:null,status:candidate.decisionStatus}} busy={busy} decide={(action,edited)=>decide(candidate.id,action,edited??null)}/>)}</div></article>)}{data&&contexts.filter(context=>category(context)===tab).length===0&&<div className="empty-state card"><Inbox size={30}/><h2>{tab==="pending"?"没有待整理的语料":tab==="review"?"没有待确认的表达":"还没有归档语料"}</h2><p>{tab==="pending"?"把遇到的一句话留下来，慢慢积累自己的素材。":"整理与确认后的语料会保留在这里。"}</p></div>}{!data&&<p className="empty-inline">正在读取语料…</p>}</div>
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
