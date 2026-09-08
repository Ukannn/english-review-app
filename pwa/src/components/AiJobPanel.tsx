import { useEffect, useRef, useState } from "react";
import type { AiJob, AiJobPrompt, ApiClient } from "../lib/contracts";
import { makeIdempotencyKey } from "../lib/hash";

export const CHATGPT_COMMAND = "处理 English Learning Lab 当前等待任务，并通过现有 API 合同写入后读回验证。";
const jobLabels: Record<AiJob["kind"], string> = { context_extract: "整理这段语料", candidate_generate: "补充学习候选", question_prepare: "生成今天的题目", grade_submission: "批改本次答案" };
type Props = { api: ApiClient; kind: AiJob["kind"]; subjectId?: string | null; requestedCount?: number | null; onImported?(): void | Promise<void> };
const closed = (status: string) => ["consumed", "cancelled", "expired"].includes(status);

export function AiJobPanel(props: Props) {
  return <AiJobPanelContent key={`${props.kind}:${props.subjectId ?? "default"}`} {...props} />;
}

function AiJobPanelContent({ api, kind, subjectId = null, requestedCount = null, onImported }: Props) {
  const [job, setJob] = useState<AiJobPrompt | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const active = useRef(false);
  const operation = useRef(false);
  const completed = useRef<string | null>(null);
  const requestKey = useRef(makeIdempotencyKey(kind));
  const onComplete = useRef(onImported);
  onComplete.current = onImported;
  const storageKey = `english-review:ai-job:${kind}:${subjectId ?? "default"}`;

  async function receive(next: AiJobPrompt) {
    if (!active.current) return;
    setJob(next);
    if (closed(next.status)) localStorage.removeItem(storageKey);
    else localStorage.setItem(storageKey, next.jobId);
    if (next.status === "consumed" && completed.current !== next.jobId) {
      // The server is authoritative: copying a command never marks a task done.
      await onComplete.current?.();
      if (!active.current) return;
      completed.current = next.jobId;
      setMessage("已保存，学习内容已更新。");
    } else if (next.status === "cancelled" || next.status === "expired") {
      requestKey.current = makeIdempotencyKey(kind);
      setMessage(next.status === "cancelled" ? "本次处理已取消。" : "本次处理已过期，请重新准备。");
    }
  }

  useEffect(() => {
    let disposed = false;
    active.current = true;
    operation.current = true;
    setBusy(true);
    async function restore() {
      try {
        const pending = await api.getPendingAiJobs();
        if (disposed) return;
        const id = pending.items.find(item => item.kind === kind && (item.subjectId ?? null) === subjectId)?.jobId ?? localStorage.getItem(storageKey);
        if (id) {
          const next = await api.getAiJobPrompt(id);
          if (!disposed) await receive(next);
        }
      } catch (error) {
        if (!disposed) setMessage(error instanceof Error ? error.message : "无法读取处理状态，请稍后重试。");
      } finally {
        if (!disposed) { operation.current = false; setBusy(false); }
      }
    }
    void restore();
    return () => { disposed = true; active.current = false; };
  }, [api, storageKey, kind, subjectId]);

  async function prepare() {
    if (operation.current) return;
    operation.current = true; setBusy(true); setMessage(null);
    try {
      const created = await api.createAiJob(kind, requestedCount, subjectId, requestKey.current);
      if (!active.current) return;
      localStorage.setItem(storageKey, created.jobId);
      await receive(await api.getAiJobPrompt(created.jobId));
    } catch (error) {
      if (active.current) setMessage(error instanceof Error ? error.message : "准备失败，请重试。");
    } finally {
      if (active.current) { operation.current = false; setBusy(false); }
    }
  }

  async function check(silent = false) {
    if (!job || operation.current) return;
    operation.current = true;
    if (!silent) setBusy(true);
    try {
      const next = await api.getAiJobPrompt(job.jobId);
      await receive(next);
      if (active.current && !closed(next.status)) setMessage("等待 ChatGPT 处理，完成后会自动更新。");
    } catch (error) {
      if (active.current) setMessage(error instanceof Error ? `状态检查失败：${error.message}` : "暂时无法检查状态，稍后会自动重试。");
    } finally {
      if (active.current) { operation.current = false; if (!silent) setBusy(false); }
    }
  }

  useEffect(() => {
    if (!job || (closed(job.status) && job.status !== "consumed") || completed.current === job.jobId) return;
    const timer = window.setInterval(() => { void check(true); }, 10000);
    const focus = () => { void check(true); };
    window.addEventListener("focus", focus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", focus); };
  }, [api, job]);

  async function copy() {
    try { await navigator.clipboard.writeText(CHATGPT_COMMAND); if (active.current) setMessage("已复制，请发给已连接 Supabase 的 ChatGPT。完成后此页会自动更新。"); }
    catch { if (active.current) setMessage("无法自动复制，请选中上方指令后复制。"); }
  }

  async function cancel() {
    if (!job || operation.current) return;
    operation.current = true; setBusy(true);
    try {
      await api.cancelAiJob(job.jobId);
      // Read back: cancellation can race with an external completion.
      await receive(await api.getAiJobPrompt(job.jobId));
    } catch (error) { if (active.current) setMessage(error instanceof Error ? error.message : "取消失败，请重试。"); }
    finally { if (active.current) { operation.current = false; setBusy(false); } }
  }

  const canPrepare = !job || ["cancelled", "expired"].includes(job.status);
  return <section className="prompt-box card">
    <h2>{jobLabels[kind]}</h2>
    {canPrepare ? <><p>准备好后，发一句指令给 ChatGPT 即可处理。</p><button className="primary-button" disabled={busy} onClick={() => void prepare()}>{busy ? "正在读取…" : "准备 AI 处理"}</button></> : <>
      <p>{job.status === "consumed" ? "处理完成，内容已保存。" : "把下面一句话发给已连接 Supabase 的 ChatGPT，它会生成并保存结果，此页会自动更新。"}</p>
      {job.status !== "consumed" && <><label className="answer-field"><span>发给 ChatGPT 的指令</span><textarea readOnly rows={2} value={CHATGPT_COMMAND} /></label><div className="button-row"><button className="primary-button" onClick={() => void copy()}>复制给 ChatGPT</button><button className="secondary-button" disabled={busy} onClick={() => void check()}>检查进度</button><button className="quiet-button" disabled={busy} onClick={() => void cancel()}>取消处理</button></div></>}
    </>}
    {message && <p role="status" className="status-message">{message}</p>}
  </section>;
}
