// Local preview fixtures. Selected only when VITE_DEMO_MODE is true.
import type { ApiClient, DashboardData, GradeStatus, GradeResult, PhraseDetail, PhraseSummary, ReviewBootstrap, ReviewQuestion, SubmissionStatus } from "./contracts";
import { demoApi } from "./demoApi";
import { addLearningDays } from "./learningDate";

const day = "2026-09-30";
const examples = [
  ["提供进展更新", "provide an update", "I'll provide an updade tomorrow.", "拼写需要修正：updade → update。", "partial", "spelling"],
  ["环比增长", "month-over-month growth", "We saw MoM growth of 8%.", "MoM 在这个语境里表达成立；这次没有测到完整目标词块。", "not_measured", null],
  ["同比增长", "year-over-year growth", "Revenue increased 12% YoY.", "YoY 是合理缩写；完整目标词块需要另一次提取来验证。", "not_measured", null],
  ["抽出时间", "set aside time", "I couldn't remember this expression.", "下次先独立回忆 set aside time，再放进自己的句子。", "forgotten", "recall"],
  ["跟进进展", "follow up on", "I'll follow up on the request.", "表达自然，目标提取正确。", "correct", null],
  ["达成一致", "reach an agreement", "We reached an agreement yesterday.", "表达自然，目标提取正确。", "correct", null],
  ["考虑到", "take into account", "We should take the cost into account.", "表达自然，目标提取正确。", "correct", null],
  ["保持联系", "stay in touch", "Let's stay in touch after the project.", "表达自然，目标提取正确。", "correct", null],
  ["提出问题", "raise a concern", "I'd like to raise a concern about the timeline.", "表达自然，目标提取正确。", "correct", null],
  ["按计划进行", "stay on track", "The project is staying on track.", "表达自然，目标提取正确。", "correct", null],
] as const;
const questions: ReviewQuestion[] = examples.map(([cue, target, answer], i) => ({
  id: `preview-question-${i}`, position: i + 1, phraseId: `preview-phrase-${i}`, candidateId: null, questionType: "collocation_recall", phase: "review", answerForm: "chunk", promptZh: `请写出“${cue}”的自然英语搭配，并在工作语境中使用。`, promptEn: null, expectedAnswers: [target], acceptedVariants: [], semanticBoundary: null, contentHash: `preview-${i}`, ruleVersion: "english_v3", draft: { answer, revision: 1, answerHash: `preview-answer-${i}`, status: "submitted" },
}));
const grades: GradeStatus[] = examples.map(([, target, answer, feedback, outcome, category], i) => ({
  position: i + 1, result: outcome === "forgotten" ? "forgotten" : outcome === "partial" ? "difficult" : "normal", feedbackZh: feedback, errorCategory: category, confidence: .95, evidence: answer, expectedAnswer: target, observedAnswer: answer, status: "committed", needsConfirmation: false, extraPractice: [], targetOutcome: outcome, meaningOk: outcome !== "forgotten", naturalness: outcome === "partial" ? "minor_issue" : "natural", hintUsed: false,
}));
const items: PhraseSummary[] = Array.from({ length: 125 }, (_, i) => {
  const unlearned = i >= examples.length && i < examples.length + 18;
  return {
  id: `preview-phrase-${i}`, chunk: i < examples.length ? examples[i][1] : `example expression ${i + 1}`, cueZh: i < examples.length ? examples[i][0] : `示例表达 ${i + 1}`, type: "collocation", topic: "work", difficulty: "medium", status: i >= 100 ? "mastered" : "active", reviewStage: unlearned ? 0 : i >= 100 ? 5 + i % 3 : 1 + i % 4, timesSeen: unlearned ? 0 : 4 + i % 12, timesCorrect: unlearned ? 0 : Math.min(4 + i % 12, 3 + i % 8), lastReviewedAt: unlearned ? null : `${day}T03:23:05Z`, nextReviewAt: `${addLearningDays(day, i % 35 - 4)}T16:00:00Z`, naturalExample: i < examples.length ? examples[i][2] : "Example content for a local design preview.", lastResult: unlearned ? null : i < examples.length ? grades[i].result : i % 11 === 0 ? "difficult" : "normal",
  };
});
const dashboard: DashboardData = {
  ok: true, learningDate: day, today: { planned: 10, completed: 10, waitingForGrading: 0 }, totals: { phrases: items.length, reviews: 993, accuracy: 78.4 },
  analytics: { ruleVersion: "english_v2", legacyReviews: 973, days: [] },
  v3: { completedLessons: 2, dueCount: items.filter(p => p.nextReviewAt! < `${day}T16:00:00Z`).length, burden: [{ date: day, value: "right" }], days: Array.from({ length: 14 }, (_, i) => ({ date: addLearningDays(day, i - 13), independentAttempts: i === 12 ? 8 : i === 13 ? 6 : 0, independentSuccess: i === 12 ? 4 : i === 13 ? 5 : 0, expressionAttempts: i > 11 ? 2 : 0, expressionSuccess: i === 12 ? 2 : 0, attempts: i > 11 ? 10 : 0, hinted: 0, gapAttempts: 0, gapSuccess: 0, unmeasured: i > 11 ? 1 : 0, delayedAttempts: 0, delayedSuccess: 0, durationMinutes: i > 11 ? 16 : null })) },
};
const bootstrap: ReviewBootstrap = { ok: true, ruleVersion: "english_v3", state: "committed", learningDate: day, queueId: "preview-queue", actualCount: 10, session: { id: "preview-session", revision: 3, maxQuestions: 10, status: "committed", submissionId: "preview-submission" }, questions, settings: { defaultQuestionCount: 8, todayQuestionCount: 10, minimumTodayCount: 4, revision: 1, ruleVersion: "english_v3" } };
const feedback: SubmissionStatus = { ok: true, ruleVersion: "english_v3", submissionId: "preview-submission", sessionId: "preview-session", status: "committed", revision: 3, answerHash: "preview-frozen", errorCode: null, errorDetail: null, journal: { status: "committed", lastCompletedStep: "readback", readbackStatus: "verified_complete", errorCode: null }, grades, lessonSummary: { title: "本次练过的表达", expressions: examples.map(e => e[1]), burden: "right", readingCompleted: true, skipped: 0, nextFocus: "下次把目标词块完整说出来。" } };

function previewGrades(): GradeStatus[] {
  const variant = new URLSearchParams(location.search).get("feedback");
  const result = structuredClone(grades);
  if (variant === "0" || variant === "1" || variant === "2") result.forEach((grade, i) => {
    if (i >= Number(variant)) Object.assign(grade, { result: "normal", targetOutcome: "correct", meaningOk: true, naturalness: "natural", errorCategory: null, observedAnswer: grade.expectedAnswer, feedbackZh: "表达自然，目标提取正确。" });
  });
  if (variant === "long") {
    result[0].observedAnswer = "I'll provide an updade tomorrow, once the team has reviewed the latest figures and confirmed how the revised timeline will affect the launch. We also need to explain which assumptions have changed, what we have already verified, and which questions still need a decision before we can commit to the next step.";
    result[0].feedbackZh = "这是一条专门用于长文本验收的本地示例。拼写应为 update；完整原答保留，超过统一高度时可在卡片内上下滚动。";
  }
  return result;
}

export const designDemoApi: ApiClient = {
  ...demoApi,
  async getReviewBootstrap() { const next = structuredClone(bootstrap), variants = previewGrades(); next.questions.forEach((question, i) => { if (question.draft) question.draft.answer = variants[i].observedAnswer ?? ""; }); return next; },
  async getDashboard() { return structuredClone(dashboard); },
  async getSubmissionStatus() { return { ...structuredClone(feedback), grades: previewGrades() }; },
  async recordLessonActivity() { return { ok: true }; },
  async setLearningSettings() { return { ok: true, defaultCount: 8, revision: 2 }; },
  async getPhraseLibrary(search, limit = 100, offset = 0) { const filtered = items.filter(p => !search || `${p.chunk} ${p.cueZh}`.toLowerCase().includes(search.toLowerCase())); return { ok: true, items: structuredClone(filtered.slice(offset, offset + limit)) }; },
  async getPhraseDetail(id): Promise<PhraseDetail> { const p = items.find(p => p.id === id); if (!p) throw new Error("表达不存在。"); const index = items.indexOf(p); return { ok: true, phrase: { ...p, commonMistake: null, notes: null, canonicalPattern: p.chunk }, stats: { timesSeen: p.timesSeen, timesCorrect: p.timesCorrect, lastReviewedAt: p.lastReviewedAt }, history: p.timesSeen ? [day, addLearningDays(day, -1), addLearningDays(day, -12)].map((d, i) => ({ reviewedAt: `${d}T03:23:05Z`, result: (i === 0 ? p.lastResult ?? "normal" : i === 1 && p.id === "preview-phrase-3" ? "forgotten" : "normal") as GradeResult, prompt: index < examples.length ? questions[index].promptZh : `请使用 ${p.chunk} 表达一个工作场景。`, userAnswer: index < examples.length && i === 0 ? examples[index][2] : "This is a saved preview answer.", expectedAnswer: p.chunk })) : [] }; },
};
