import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookmarkPlus, Check, X } from "lucide-react";
import type { ApiClient } from "../lib/contracts";
import { captureSelection, mergeCaptureSpans, type CapturedSelection, type CaptureSpan } from "../lib/captureSelection";
import { makeIdempotencyKey } from "../lib/hash";

interface CaptureGroup {
  key: string;
  rawText: string;
  sourceTitle: string;
  sourceUrl: string;
  selectedSpans: CaptureSpan[];
  attempted?: boolean;
  contextId?: string;
}
function addCapture(groups: CaptureGroup[], selection: CapturedSelection): CaptureGroup[] {
  const match = groups.find(group => !group.attempted && group.rawText === selection.rawText
    && group.sourceUrl === selection.sourceUrl && group.sourceTitle === selection.sourceTitle);
  if (match) return groups.map(group => group === match
    ? {...group, selectedSpans: mergeCaptureSpans(group.selectedSpans, selection.span, group.rawText)} : group);
  return [...groups, {key: makeIdempotencyKey("capture"), rawText: selection.rawText,
    sourceTitle: selection.sourceTitle, sourceUrl: selection.sourceUrl, selectedSpans: [selection.span]}];
}

export function GlobalCapture({client, sourceTitle, onSaved}: {
  client: ApiClient; sourceTitle: string; onSaved(): void;
}) {
  const [selection, setSelection] = useState<CapturedSelection | null>(null);
  const [groups, setGroups] = useState<CaptureGroup[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dialog, setDialog] = useState<HTMLDialogElement | null>(null);
  const saving = useRef(false);
  useEffect(() => {
    const root = document.getElementById("learning-content");
    if (!root) return;
    function readSelection() {
      if (saving.current || document.activeElement?.closest("[data-capture-ui]")) return;
      setSelection(captureSelection(window.getSelection(), root!, sourceTitle));
    }
    function trackDialog() {
      const active = root!.querySelector<HTMLDialogElement>("dialog[open]");
      setDialog(active);
    }
    const observer = new MutationObserver(trackDialog);
    observer.observe(root, {subtree: true, childList: true, attributes: true, attributeFilter: ["open"]});
    trackDialog();
    document.addEventListener("selectionchange", readSelection);
    document.addEventListener("pointerup", readSelection);
    document.addEventListener("keyup", readSelection);
    return () => {
      observer.disconnect();
      document.removeEventListener("selectionchange", readSelection);
      document.removeEventListener("pointerup", readSelection);
      document.removeEventListener("keyup", readSelection);
    };
  }, [sourceTitle]);
  useEffect(() => {setSelection(null);}, [sourceTitle, dialog]);

  function mark() {
    if (!selection || saving.current) return;
    setGroups(current => addCapture(current, selection));
    setSelection(null); setMessage(null);
    window.getSelection()?.removeAllRanges();
  }
  async function save() {
    if (saving.current) return;
    const batch = selection ? addCapture(groups, selection) : groups;
    if (!batch.length) return;
    saving.current = true; setBusy(true); setMessage(null); setSelection(null);
    window.getSelection()?.removeAllRanges();
    // Freeze each payload before its first attempt; timeout retries use the same key.
    const pending = batch.map(group => ({...group, attempted: true}));
    setGroups(pending);
    let confirmed = 0;
    const failures: string[] = [];
    try {
      for (const group of pending) {
        if (group.contextId) continue;
        try {
          const response = await client.saveContext({rawText: group.rawText, selectedSpans: group.selectedSpans,
            sourceTitle: group.sourceTitle, sourceUrl: group.sourceUrl,
            userNote: "学习页面随手收录，标记的是想学会的英语或表达。"}, null, group.key);
          const result = response as {ok?: boolean; contextId?: string} | null;
          if (!result?.ok || typeof result.contextId !== "string") throw new Error("未收到保存确认。");
          group.contextId = result.contextId;
        } catch (caught) {failures.push(caught instanceof Error ? caught.message : "保存失败。");}
      }
      const inbox = await client.getContextInbox();
      if (!inbox.ok) throw new Error("语料库暂时无法确认保存结果。");
      const remaining = pending.filter(group => {
        const context = inbox.contexts.find(item => item.id === group.contextId);
        const verified = context && context.rawText === group.rawText
          && context.sourceUrl === group.sourceUrl && context.sourceTitle === group.sourceTitle
          && group.selectedSpans.length === context.selectedSpans.length
          && group.selectedSpans.every(span => context.selectedSpans.some(value => {
            const saved = value as Partial<CaptureSpan> | null;
            return saved?.text === span.text && saved.start === span.start && saved.end === span.end;
          }));
        if (verified) confirmed += 1;
        return !verified;
      });
      setGroups(remaining);
      if (confirmed) onSaved();
      setMessage(remaining.length
        ? `${confirmed ? `已收录 ${confirmed} 段；` : ""}还有 ${remaining.length} 段未确认，标记已保留，请重试。${failures[0] ?? ""}`
        : `已加入语料库 · ${confirmed} 段原文，稍后可到「语料」统一整理。`);
    } catch (caught) {
      setGroups([...pending]);
      setMessage(`收录结果暂未确认，标记已保留，请重试。${caught instanceof Error ? caught.message : ""}`);
    } finally {saving.current = false; setBusy(false);}
  }
  const count = groups.reduce((total, group) => total + group.selectedSpans.length, 0);
  if (!selection && !count && !message && !dialog) return null;
  const toolbar = <aside className={`global-capture ${dialog ? "global-capture--dialog" : ""}`} aria-label="随手收录" data-capture-ui>
    <div className="global-capture__top"><div className="global-capture__hint"><BookmarkPlus size={18}/><span>{count ? `已标记 ${count} 处，尚未完成收录` : "随手收录"}<small>划选或长按选中英语，保留原文语境</small></span></div>
      <div className="button-row">
        {selection && <button type="button" className="secondary-button" disabled={busy} onPointerDown={event => event.preventDefault()} onClick={mark}>标记所选</button>}
        <button type="button" className="primary-button" disabled={busy || (!count && !selection)} onPointerDown={event => event.preventDefault()} onClick={() => void save()}><Check size={16}/>{busy ? "正在收录…" : groups.some(group => group.attempted) ? "重试收录" : "加入语料库"}</button>
      </div>
    </div>
    {selection && <p className="global-capture__selection" lang="en">所选：{selection.span.text}</p>}
    {!!count && <div className="global-capture__marks">{groups.flatMap(group => group.selectedSpans.map(span => <button type="button" className="global-capture__mark" key={`${group.key}:${span.start}:${span.end}`} disabled={busy || group.attempted} aria-label={`移除标记 ${span.text}`} title={group.rawText} onClick={() => setGroups(current => current.flatMap(item => {
      if (item.key !== group.key) return [item];
      const selectedSpans = item.selectedSpans.filter(value => value.start !== span.start || value.end !== span.end);
      return selectedSpans.length ? [{...item, selectedSpans}] : [];
    }))}><span lang="en">{span.text}</span><X size={14}/></button>))}</div>}
    {message && <p className="global-capture__message" role="status">{message}</p>}
  </aside>;
  return dialog ? createPortal(toolbar, dialog) : toolbar;
}
