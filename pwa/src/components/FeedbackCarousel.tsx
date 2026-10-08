import { TypographyText } from "./TypographyText";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { GradeStatus } from "../lib/contracts";
import { spellingPresentation, type FeedbackTextPart } from "../lib/feedbackText";

export function feedbackCategory(grade: GradeStatus): string {
  if (grade.targetOutcome === "not_measured") return grade.meaningOk === true ? "意思正确 · 目标形式未测到" : "目标完整形式待验证";
  if (grade.errorCategory?.toLowerCase().includes("spell")) return "拼写修正";
  if (grade.targetOutcome === "forgotten" || grade.result === "forgotten") return "下次再提取";
  if (grade.hintUsed) return "提示后完成";
  if (grade.naturalness && grade.naturalness !== "natural") return "表达可以更自然";
  return "目标待巩固";
}

export function FeedbackCarousel({ grades, active, onOpen }: { grades: GradeStatus[]; active: boolean; onOpen(position: number): void }) {
  const items = grades.filter(g => g.targetOutcome === "not_measured" || g.targetOutcome === "partial" || g.targetOutcome === "forgotten" || g.result === "forgotten" || g.result === "difficult" || g.hintUsed || (g.naturalness !== undefined && g.naturalness !== "natural"));
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(() => !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches && document.visibilityState !== "hidden" && active);
  const [announcement, setAnnouncement] = useState("");
  const id = useId();
  const contents = useRef(new Map<number, HTMLDivElement>());
  const stage = useRef<HTMLDivElement>(null);
  const touch = useRef<{ id: number; x: number; y: number } | null>(null);
  const signature = items.map(g => `${g.position}:${g.targetOutcome}:${g.feedbackZh}`).join("|");
  const current = items[index % Math.max(1, items.length)];
  const pause = () => setPlaying(false);
  useLayoutEffect(() => {
    contents.current.forEach(node => { node.scrollTop = 0; });
  }, [current?.position, signature]);
  useEffect(() => { setIndex(0); }, [signature]);
  useEffect(() => { if (!active) setPlaying(false); }, [active]);
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === "hidden") setPlaying(false); };
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const reduced = () => { if (media?.matches) setPlaying(false); };
    document.addEventListener("visibilitychange", hidden);
    media?.addEventListener("change", reduced);
    const dialogs = new MutationObserver(() => { if (document.querySelector("dialog[open]")) setPlaying(false); });
    dialogs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"], childList: true });
    return () => { document.removeEventListener("visibilitychange", hidden); media?.removeEventListener("change", reduced); dialogs.disconnect(); };
  }, []);
  useEffect(() => {
    if (!playing || !active || items.length < 2) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden" || document.querySelector("dialog[open]")) { pause(); return; }
      setIndex(i => (i + 1) % items.length);
    }, 9000);
    return () => window.clearInterval(timer);
  }, [playing, active, items.length, signature]);
  function choose(next: number, focusStage = false) {
    const value = (next + items.length) % items.length;
    if (focusStage) stage.current?.focus({ preventScroll: true });
    pause(); setIndex(value); setAnnouncement(`第 ${value + 1} 条，共 ${items.length} 条`);
  }
  if (!current) return <section className="feedback-empty"><h2>本次重点回看</h2><p>本次没有已记录的重点项。完整反馈中保留了逐题结果。</p><button className="secondary-button" onClick={() => onOpen(0)}>查看完整反馈</button></section>;
  const previous = (index + items.length - 1) % items.length, next = (index + 1) % items.length;
  return <section className="feedback-carousel review-carousel" aria-roledescription="轮播" aria-label="本次重点回看" onFocusCapture={event => { if (!(event.target as HTMLElement).closest(".carousel-play")) pause(); }}>
    <div className="carousel-heading"><h2>重点回看</h2><span>{items.length} 条反馈</span></div>
    <div ref={stage} className="carousel-stage carousel-track" id={id} tabIndex={0} aria-label="反馈卡片，可使用左右方向键切换" onPointerEnter={pause} onScrollCapture={pause}
      onPointerDown={event => {
        pause();
        if (event.pointerType === "touch" && !(event.target as HTMLElement).closest("button")) {
          touch.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        }
      }}
      onPointerUp={event => {
        const start = touch.current; touch.current = null;
        if (!start || start.id !== event.pointerId || window.getSelection()?.toString()) return;
        const dx = event.clientX - start.x, dy = event.clientY - start.y;
        if (Math.abs(dx) > 35 && Math.abs(dx) > Math.abs(dy) * 1.25) choose(index + (dx < 0 ? 1 : -1));
      }} onPointerCancel={() => { touch.current = null; }}
      onKeyDown={event => { if ((event.target === event.currentTarget || (event.target as HTMLElement).closest(".feedback-card-content")) && (event.key === "ArrowLeft" || event.key === "ArrowRight")) { event.preventDefault(); choose(index + (event.key === "ArrowLeft" ? -1 : 1)); } }}>
      {items.map((grade, position) => {
        const shown = position === index % items.length || position === next || (items.length > 2 && position === previous);
        const slot = position === index % items.length ? "active" : position === next ? "right" : "left";
        // Preserve the card's identity while changing its slot so the sample's CSS transform animates it.
        return <Fragment key={grade.position}>
          <article className="review-slide carousel-card" data-slot={slot} data-parked={!shown} data-position={grade.position} aria-hidden={slot !== "active"} inert={slot !== "active"} aria-label={`第 ${position + 1} 条，共 ${items.length} 条`}>
            <div ref={node => { if (node) contents.current.set(grade.position, node); else contents.current.delete(grade.position); }} className="feedback-card-content" tabIndex={slot === "active" ? 0 : -1} role="group" aria-label="反馈内容，可上下滚动"><FeedbackFace grade={grade}/></div>
          </article>
          {shown && slot !== "active" && <button className="deck-card-button" data-slot={slot} aria-label={`选择${slot === "left" ? "上一条" : "下一条"}：${feedbackCategory(grade)}`} onClick={event => choose(position, event.detail === 0)}/>}
        </Fragment>;
      })}
    </div>
    {items.length > 1 && <div className="carousel-controls"><div className="carousel-status"><span>{index % items.length + 1} / {items.length}</span><button className="carousel-play" aria-label={playing ? "暂停自动轮播" : "播放自动轮播"} aria-pressed={playing} aria-controls={id} onClick={() => { if (active && document.visibilityState !== "hidden" && !document.querySelector("dialog[open]")) setPlaying(value => !value); }}>{playing ? <Pause size={13}/> : <Play size={13}/>}<span>{playing ? "暂停" : "播放"}</span></button></div><div className="carousel-arrows"><button className="icon-button" aria-label="上一条反馈" aria-controls={id} onClick={() => choose(index - 1)}><ChevronLeft size={21}/></button><button className="icon-button" aria-label="下一条反馈" aria-controls={id} onClick={() => choose(index + 1)}><ChevronRight size={21}/></button></div></div>}
    <div className="carousel-bottom"><button className="text-button" onClick={() => { pause(); onOpen(current.position); }}>查看完整反馈 ↗</button></div>
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
  </section>;
}

function FeedbackFace({ grade }: { grade: GradeStatus }) {
  const evidence = grade.evidence?.trim();
  const answer = evidence && grade.observedAnswer?.includes(evidence) ? evidence : grade.observedAnswer;
  const spelling = spellingPresentation(answer, grade);
  const category = feedbackCategory(grade);
  return <><span className={`feedback-type ${category === "拼写修正" ? "correction" : ""}`}>{category}</span><div className="answer-comparison"><div><label>你的表达{answer !== grade.observedAnswer ? " · 相关片段" : ""}</label><p lang="en">{spelling ? <FeedbackWords parts={spelling.original}/> : answer || "未提供答案"}</p></div><span className="answer-arrow" aria-hidden="true">→</span><div><label>{spelling ? "建议写法" : grade.targetOutcome === "not_measured" ? "目标完整形式" : "参考表达"}</label><p lang="en">{spelling ? <FeedbackWords parts={spelling.suggestion} corrected/> : grade.expectedAnswer || "本题未提供参考"}</p></div></div><p className="card-rationale"><TypographyText text={grade.feedbackZh || "本题未提供判定说明，可查阅完整反馈。"}/></p></>;
}

function FeedbackWords({ parts, corrected = false }: { parts: FeedbackTextPart[]; corrected?: boolean }) {
  return <>{parts.map((part, index) => !part.changed ? part.text : corrected ? <strong key={index}>{part.text}</strong> : <span key={index} className="marked-word">{part.text}</span>)}</>;
}
