import { useState } from "react";
import type { ReviewQuestion } from "./contracts";

const key = (sessionId: string) => `english-review-position:v1:${sessionId}`;

export function clearReviewPosition(sessionId: string) {
  try { sessionStorage.removeItem(key(sessionId)); } catch { /* Navigation also works without storage. */ }
}

export function useReviewPosition(sessionId: string, questions: ReviewQuestion[]) {
  const [selected, setSelected] = useState<{ id: string; position: number } | null>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(key(sessionId)) ?? "null");
      return questions.some(q => q.id === saved?.id && q.position === saved?.position) ? saved : null;
    } catch { return null; }
  });
  const selectedQuestion = questions.find(q => q.id === selected?.id && q.position === selected?.position);
  function selectQuestion(question?: ReviewQuestion) {
    const next = question ? { id: question.id, position: question.position } : null;
    setSelected(next);
    try {
      if (next) sessionStorage.setItem(key(sessionId), JSON.stringify(next));
      else clearReviewPosition(sessionId);
    } catch { /* A blocked store must not prevent jumping between questions. */ }
  }
  return { selectedQuestion, selectQuestion };
}
