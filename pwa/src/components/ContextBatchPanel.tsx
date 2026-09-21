import { useCallback, useEffect, useRef, useState } from "react";
import type { AiJob, ApiClient } from "../lib/contracts";
import { makeIdempotencyKey } from "../lib/hash";
import { CHATGPT_COMMAND } from "./AiJobPanel";

type Props = { api: ApiClient; contextIds: string[]; onRefresh(): Promise<void> };
export function ContextBatchPanel({ api, contextIds, onRefresh }: Props) {
  const [jobs, setJobs] = useState<AiJob[]>([]);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const locked = useRef(false);
  const keys = useRef(new Map<string, string>());
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  const readJobs = useCallback(async () => {
    const result = await api.getPendingAiJobs();
    const pending = result.items.filter(job => job.kind === "context_extract");
    setJobs(pending);
    return pending;
  }, [api]);
  useEffect(() => {
    let disposed = false;
    async function check() {
      if (locked.current) return;
      locked.current = true;
      try {
        const result = await api.getPendingAiJobs();
        if (!disposed) {
          setJobs(result.items.filter(job => job.kind === "context_extract"));
          await refresh.current();
        }
      } catch (error) {
        if (!disposed) setMessage(error instanceof Error ? error.message : "读取处理进度失败，请重试。");
      } finally { locked.current = false; if (!disposed) setBusy(false); }
    }
    void check();
    const timer = window.setInterval(() => void check(), 10000);
    const focus = () => void check();
    window.addEventListener("focus", focus);
    return () => { disposed = true; window.clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [api]);

  async function prepare() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setMessage(null);
    try {
      const pending = await readJobs();
      const existing = new Set(pending.map(job => job.subjectId));
      let failed = 0;
      for (const id of contextIds) {
        if (existing.has(id)) continue;
        let key = keys.current.get(id);
        if (!key) { key = makeIdempotencyKey(`context:${id}`); keys.current.set(id, key); }
        try {
          const job = await api.createAiJob("context_extract", null, id, key);
          if (job.status === "prepared") setJobs(current => [...current.filter(item => item.jobId !== job.jobId), job]);
          else keys.current.delete(id);
        } catch { failed += 1; }
      }
      await refresh.current();
      setMessage(failed ? `${failed} 条语料准备失败，点击重试剩余语料；已准备的任务会保留。` : "语料已统一准备好，复制一次指令即可交给 ChatGPT 处理。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "准备失败，请重试。"); }
    finally { locked.current = false; setBusy(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(CHATGPT_COMMAND); setMessage("已复制，请发给已连接 Supabase 的 ChatGPT。整理结果会自动更新。"); }
    catch { setMessage("无法自动复制，请选中指令后复制。"); }
  }
  const remaining = contextIds.filter(id => !jobs.some(job => job.subjectId === id)).length;
  return <section className="prompt-box card">
    <h2>统一整理语料</h2>
    <p>一次准备全部待整理语料，只需向 ChatGPT 发送一次指令。整理完成后，在「待确认」中确认表达。</p>
    {remaining > 0 && <button className="primary-button" disabled={busy} onClick={() => void prepare()}>{busy ? "正在准备…" : jobs.length ? `整理剩余 ${remaining} 条语料` : `一次整理全部 ${remaining} 条语料`}</button>}
    {jobs.length > 0 && <><p>已有 {jobs.length} 条语料等待 ChatGPT 处理。</p><label className="answer-field"><span>发给 ChatGPT 的指令</span><textarea readOnly rows={2} value={CHATGPT_COMMAND}/></label><button className="primary-button" disabled={busy} onClick={() => void copy()}>复制给 ChatGPT</button></>}
    {!busy && !remaining && !jobs.length && <p>当前语料已整理完成。</p>}
    {message && <p role="status" className="status-message">{message}</p>}
  </section>;
}
