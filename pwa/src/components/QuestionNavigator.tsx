import { Check, ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import type { CheckpointAnswer, ReviewQuestion } from "../lib/contracts";

interface Props {
  questions: ReviewQuestion[];
  currentId?: string;
  answers: Map<number, CheckpointAnswer>;
  inputs: Record<number, string>;
  disabled: boolean;
  lockedIds?: Set<string>;
  onSelect(question: ReviewQuestion): void;
}

export function QuestionNavigator({ questions, currentId, answers, inputs, disabled, lockedIds, onSelect }: Props) {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  const completed = questions.filter(q => answers.has(q.position)).length;
  const currentIndex = questions.findIndex(q => q.id === currentId);
  return <aside className={`question-navigator card${expanded ? " is-expanded" : ""}`} aria-label="答题卡">
    <header className="question-navigator__heading"><h2>答题卡</h2><span>已作答 {completed}/{questions.length}</span></header>
    <button className="question-navigator__toggle" aria-expanded={expanded} aria-controls={bodyId} onClick={() => setExpanded(value => !value)}>
      <strong>答题卡 <span>已作答 {completed}/{questions.length}</span></strong>
      <span>{currentIndex < 0 ? "查看题号" : `第 ${currentIndex + 1} 题`}<ChevronDown size={16} aria-hidden="true"/></span>
    </button>
    <div className="question-navigator__body" id={bodyId}>
      <p className="question-navigator__hint">点选题号，继续作答或回看。</p>
      <div className="question-navigator__grid">
        {questions.map((question, index) => {
          const answer = answers.get(question.position);
          const locked = lockedIds?.has(question.id);
          const state = answer?.attemptState === "skipped" ? "skipped" : answer ? "complete" : inputs[question.position]?.trim() ? "draft" : "empty";
          const label = locked ? "阅读后解锁" : ({complete:"已作答",draft:"草稿",skipped:"已跳过",empty:"未答"})[state];
          return <button key={question.id} className={`question-navigator__number is-${state}${question.id === currentId ? " is-current" : ""}`}
            aria-label={`第 ${index + 1} 题 · ${label}`} aria-current={question.id === currentId ? "step" : undefined}
            disabled={disabled || locked} onClick={() => { setExpanded(false); onSelect(question); }}>
            {index + 1}{state === "complete" ? <Check size={10} aria-hidden="true"/> : state === "draft" ? <i aria-hidden="true"/> : state === "skipped" ? <small aria-hidden="true">−</small> : null}
          </button>;
        })}
      </div>
      <div className="question-navigator__legend" aria-hidden="true"><span><i className="is-current"/>当前</span><span><i className="is-complete"/>已作答</span><span><i className="is-draft"/>草稿</span><span><i/>未答</span></div>
      {lockedIds?.size ? <p className="question-navigator__hint">读后表达在完成阅读后解锁。</p> : null}
    </div>
  </aside>;
}
