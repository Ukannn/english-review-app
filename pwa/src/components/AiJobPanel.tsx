import { useEffect, useRef, useState } from "react";
import type { AiJob, AiJobPrompt, ApiClient } from "../lib/contracts";
import { makeIdempotencyKey } from "../lib/hash";

const jobLabels: Record<AiJob["kind"], string> = { context_extract: "整理这段语料", candidate_generate: "补充学习候选", question_prepare: "生成今天的题目", grade_submission: "批改本次答案" };
export function AiJobPanel({ api, kind, subjectId = null, requestedCount = null, onImported }: { api: ApiClient; kind: AiJob["kind"]; subjectId?: string | null; requestedCount?: number | null; onImported?(): void | Promise<void> }) {
  const [job, setJob] = useState<AiJobPrompt | null>(null);
  const [payload, setPayload] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestKey = useRef(makeIdempotencyKey(kind));
  const storageKey = `english-review:ai-job:${kind}:${subjectId ?? "default"}`;
  useEffect(() => {
    const id = localStorage.getItem(storageKey);
    void (id ? Promise.resolve(id) : api.getPendingAiJobs().then(result => result.items.find(item => item.kind === kind && (item.subjectId ?? null) === subjectId)?.jobId)).then(jobId => jobId ? api.getAiJobPrompt(jobId) : null).then(result => {
      if (!result) return;
      if (["consumed", "cancelled", "expired"].includes(result.status)) localStorage.removeItem(storageKey);
      else setJob(result);
    }).catch(() => { localStorage.removeItem(storageKey); });
  }, [api, storageKey, kind, subjectId]);
  async function prepare() {
    setBusy(true); setMessage(null);
    try {
      const created = await api.createAiJob(kind, requestedCount, subjectId, requestKey.current);
      localStorage.setItem(storageKey, created.jobId);
      setJob(await api.getAiJobPrompt(created.jobId));
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "提示词准备失败，请重试。"); }
    finally { setBusy(false); }
  }
  const fullPrompt = job?.prompt ?? "";
  async function copy() {
    try { await navigator.clipboard.writeText(fullPrompt); setMessage("已复制完整提示词。请在 ChatGPT 完成后，将返回的 JSON 粘贴到下方。"); }
    catch { setMessage("无法自动复制，请展开完整提示词并手动复制。"); }
  }
  async function importResult() {
    if (!job) return; setBusy(true); setMessage(null);
    try {
      const parsed = JSON.parse(payload) as unknown;
      await api.importAiResult(job.jobId, parsed);
      localStorage.removeItem(storageKey); setPayload(""); setJob(null); requestKey.current = makeIdempotencyKey(kind);
      setMessage("校验通过，内容已导入。"); await onImported?.();
    } catch (caught) { setMessage(caught instanceof SyntaxError ? "JSON 格式无效，没有导入。请粘贴完整 JSON，不含代码围栏。" : caught instanceof Error ? caught.message : "导入未完成，请重试。"); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!job) return; setBusy(true);
    try { await api.cancelAiJob(job.jobId); localStorage.removeItem(storageKey); setJob(null); setPayload(""); requestKey.current = makeIdempotencyKey(kind); setMessage("本次准备已取消，可以重新生成。"); }
    catch (caught) { setMessage(caught instanceof Error ? caught.message : "取消失败，请重试。"); }
    finally { setBusy(false); }
  }
  return <section className="glass-card handoff-card"><h2>{jobLabels[kind]}</h2><p>复制提示词到 ChatGPT，再将结果粘贴回来。</p>{!job ? <button className="primary-button" disabled={busy} onClick={() => void prepare()}>{busy ? "正在准备…" : "准备提示词"}</button> : <><p>本次准备包含 {job.expectedCount} 项。</p><div className="button-row"><button className="primary-button" onClick={() => void copy()}>复制完整提示词</button><button className="quiet-button" disabled={busy} onClick={() => void cancel()}>取消并重新准备</button></div><details><summary>查看完整提示词</summary><pre className="prompt-preview">{fullPrompt}</pre></details><label className="answer-field json-field"><span>粘贴 ChatGPT 返回的 JSON</span><textarea value={payload} onChange={event => setPayload(event.target.value)} placeholder={'{"jobId":"…","items":[…]}'} /></label><button className="primary-button" disabled={busy || !payload.trim()} onClick={() => void importResult()}>{busy ? "正在校验…" : "校验并导入"}</button></>}{message && <p role="status" className="status-message">{message}</p>}</section>;
}
