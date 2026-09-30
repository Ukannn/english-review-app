import { History, Search, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient, PhraseDetail, PhraseSummary, ReviewBootstrap } from "../lib/contracts";
import { expressionLayer, expressionLayers, type ExpressionLayer } from "../lib/learningMetrics";
import { formatLearningTime, learningDateAt } from "../lib/learningDate";
import { PageHeading } from "./PageHeading";
import { PhraseDetailSheet } from "./LibraryViews";

export function RecordsView({ client, items, loading, error, bootstrap, active, query, dataRevision, onQueryChanged, onToday, onRefresh }: { client: ApiClient; items: PhraseSummary[] | null; loading: boolean; error: string; bootstrap: ReviewBootstrap | null; active: boolean; query: string; dataRevision: number; onQueryChanged(query: string): void; onToday(): void; onRefresh(): Promise<void> }) {
  const params = new URLSearchParams(query);
  const initialLayer = params.get("layer");
  const search = params.get("q") ?? "", date = params.get("date") ?? "", selectedId = params.get("phrase") ?? "";
  const layer: ExpressionLayer | "" = expressionLayers.some(l => l.key === initialLayer) ? initialLayer as ExpressionLayer : "";
  const [detail, setDetail] = useState<PhraseDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [expressionOpen, setExpressionOpen] = useState(false);
  const request = useRef(0);
  const cache = useRef(new Map<string, PhraseDetail>());
  const lastRevision = useRef(dataRevision);
  useEffect(() => () => { request.current++; }, []);
  useEffect(() => { if (!active) setExpressionOpen(false); }, [active]);
  const open = useCallback(async (id: string) => {
    const version = ++request.current; setBusyId(id); setDetailError("");
    try { const result = await client.getPhraseDetail(id); if (version === request.current) { cache.current.set(id, result); setDetail(result); } }
    catch (caught) { if (version === request.current) setDetailError(caught instanceof Error ? caught.message : "原始记录读取失败。"); }
    finally { if (version === request.current) setBusyId(""); }
  }, [client]);
  useEffect(() => {
    if (!selectedId) {
      request.current++; setDetail(null); setDetailError(""); setBusyId("");
      return;
    }
    const cached = cache.current.get(selectedId);
    if (cached) { request.current++; setDetail(cached); setDetailError(""); setBusyId(""); }
    else void open(selectedId);
  }, [selectedId, open]);
  useEffect(() => {
    if (lastRevision.current > 0 && lastRevision.current !== dataRevision) {
      cache.current.clear();
      if (selectedId) void open(selectedId);
    }
    lastRevision.current = dataRevision;
  }, [dataRevision, selectedId, open]);
  function updateQuery(changes: Record<string, string>) {
    const next = new URLSearchParams(query);
    Object.entries(changes).forEach(([key, value]) => value ? next.set(key, value) : next.delete(key));
    onQueryChanged(next.toString());
  }
  const filtered = items?.filter(p => (!layer || expressionLayer(p) === layer) && `${p.chunk} ${p.cueZh ?? ""}`.toLowerCase().includes(search.toLowerCase())) ?? [];
  const history = detail?.history.filter(h => !date || learningDateAt(h.reviewedAt) === date) ?? [];
  const difficultDates = new Set(detail?.history.filter(h => h.result === "forgotten" || h.result === "difficult").map(h => learningDateAt(h.reviewedAt)));
  return <section className="page-stack records-page view-enter">
    <PageHeading eyebrow="原答、参考与真实日期" title="学习记录" description="按表达查阅已经保存的练习，回到判断依据。" action={<div className="heading-icon"><History/></div>}/>
    {bootstrap?.session?.submissionId && <div className="record-current"><span>当前会话 · {bootstrap.learningDate}</span><button className="secondary-button" onClick={onToday}>打开这次反馈</button></div>}
    <p className="history-note">目前可查已收录表达的完整练习历史。搜索针对表达与中文提示，日期筛选针对选中表达；全量会话目录、旧题提示和安排变更尚未由现有接口提供。</p>
    {error && <div className="notice notice--red" role="alert"><span>{error} {items && "保留上次读取的表达目录。"}</span><button className="text-button" onClick={() => void onRefresh()}>重试</button></div>}
    <div className="records-layout"><aside className="records-directory card"><label className="search-field"><Search size={18}/><input aria-label="搜索记录中的表达" placeholder="搜索表达或中文提示" value={search} onChange={e => updateQuery({ q: e.target.value })}/></label><label className="record-filter">表达范围<select aria-label="表达记录范围" value={layer} onChange={e => updateQuery({ layer: e.target.value })}><option value="">全部表达</option>{expressionLayers.map(l => <option key={l.key} value={l.key}>{l.label}</option>)}</select></label>{!items && <p role="status">{loading ? "正在读取完整目录…" : "目录尚未读取。"}</p>}<div className="record-expression-list">{filtered.map(p => <button key={p.id} className={detail?.phrase.id === p.id ? "is-selected" : ""} aria-pressed={detail?.phrase.id === p.id} onClick={() => selectedId === p.id ? void open(p.id) : updateQuery({ phrase: p.id })} disabled={busyId === p.id}><span><strong lang="en">{p.chunk}</strong><small>{p.cueZh} · {p.timesSeen} 次 SRS 练习</small></span><ChevronRight size={16}/></button>)}{items && filtered.length === 0 && <p className="empty-inline">这个范围没有表达。可更换筛选条件。</p>}</div></aside>
    <article className="records-evidence card">{detailError && <p className="inline-error" role="alert">{detailError}{detail && "此前成功读取的记录仍保留。"}<button className="text-button" onClick={() => void open(selectedId)}>重新读取原始记录</button></p>}{busyId && <p role="status">正在读取原始记录…</p>}{detail ? <><header><div><span className="eyebrow">表达证据</span><h2 lang="en">{detail.phrase.chunk}</h2><p>{detail.phrase.cueZh}</p></div><button className="secondary-button" onClick={() => setExpressionOpen(true)}>表达详情与全部历史</button></header><label className="record-filter">筛选这个表达的学习日期<input type="date" value={date} onChange={e => updateQuery({ date: e.target.value })}/></label>{date && <button className="text-button" onClick={() => updateQuery({ date: "" })}>清除日期，查看全部历史</button>}{difficultDates.size >= 2 && <p className="record-observation">兼容判定中，有 {difficultDates.size} 个不同日期记录为困难或遗忘。请一起核对下面的成功记录；旧记录未提供提示与评分版本，暂不与新版正确率混算。</p>}<div className="record-attempts">{[...history].sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt)).map((h, i) => <article key={`${h.reviewedAt}:${i}`}><header><time>{formatLearningTime(h.reviewedAt)} · 上海</time><span className="status-chip">{{ forgotten: "遗忘", difficult: "困难", normal: "正常", mastered: "熟练" }[h.result]} · 兼容结果</span></header><h3>原题</h3><p>{h.prompt ?? "原题未记录"}</p><h3>你的原答</h3><p lang="en">{h.userAnswer ?? "原答未记录"}</p><h3>参考</h3><p lang="en">{h.expectedAnswer ?? "参考未记录"}</p></article>)}</div>{history.length === 0 && <p className="empty-inline">{date ? "这个表达在所选日期没有练习记录。它不代表当天没有其他练习。" : "这个表达还没有练习历史。"}</p>}</> : <div className="empty-inline"><History size={28}/><h2>选一个表达，查看原答</h2><p>原题、原答、参考与日期在这里查阅，保留历史原貌。</p>{date && <p>已带入日期 {date}；选取表达后查看该日记录。</p>}</div>}</article></div>
    {expressionOpen && detail && <PhraseDetailSheet detail={detail} onClose={() => setExpressionOpen(false)}/>}
  </section>;
}
