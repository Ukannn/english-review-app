import type {
  AiJob,
  AiJobPrompt,
  ApiClient,
  CheckpointResult,
  ContextInbox,
  DashboardData,
  PhraseLibrary,
  ReviewBootstrap,
  SubmissionStatus,
  SystemStatus,
} from "./contracts";

const questions = [
  ["取得稳定进展", "make steady progress", "I want to make steady progress this month."],
  ["密切关注", "keep a close eye on", "Keep a close eye on the deadline."],
  ["抽出时间", "set aside time", "Set aside time for deliberate practice."],
  ["承担责任", "take responsibility for", "Take responsibility for the outcome."],
  ["形成习惯", "build a habit of", "Build a habit of reviewing every day."],
].map(([cue, answer, example], index) => ({
  id: `00000000-0000-0000-0000-00000000010${index}`,
  position: index + 1,
  phraseId: `00000000-0000-0000-0000-00000000020${index}`,
  candidateId: null,
  questionType: "collocation_recall",
  promptZh: `请写出“${cue}”的自然英语搭配。`,
  promptEn: null,
  expectedAnswers: [answer],
  acceptedVariants: [],
  semanticBoundary: `目标搭配：${answer}`,
  contentHash: `demo-${index + 1}`,
  draft: null,
  example,
}));

let revision = 1;
let submissionState: SubmissionStatus["status"] = "submitted";

const bootstrap: ReviewBootstrap = {
  ok: true,
  state: "open",
  learningDate: new Date().toISOString().slice(0, 10),
  session: {
    id: "00000000-0000-0000-0000-000000000001",
    revision,
    maxQuestions: questions.length,
    status: "open",
  },
  questions,
  settings: { defaultQuestionCount: 12, todayQuestionCount: 12, minimumTodayCount: 1, revision: 1 },
};

const dashboard: DashboardData = {
  ok: true,
  learningDate: bootstrap.learningDate,
  today: { planned: 20, completed: 8, waitingForGrading: 1 },
  totals: { phrases: 87, reviews: 993, accuracy: 78.4 },
};

const library: PhraseLibrary = {
  ok: true,
  items: questions.map((question, index) => ({
    id: question.phraseId!,
    chunk: question.expectedAnswers[0],
    cueZh: question.promptZh?.match(/“(.+)”/)?.[1] ?? null,
    type: "collocation",
    topic: ["growth", "work", "routine"][index % 3],
    difficulty: index > 2 ? "medium" : "easy",
    status: "active",
    reviewStage: 2 + index,
    nextReviewAt: new Date(Date.now() + (index + 1) * 86400000).toISOString(),
    lastReviewedAt: new Date(Date.now() - (index + 2) * 86400000).toISOString(),
    timesSeen: 9 + index * 2,
    timesCorrect: 7 + index,
    naturalExample: question.example,
    lastResult: index % 2 ? "normal" : "mastered",
  })),
};

const contexts: ContextInbox = {
  ok: true,
  contexts: [{
    id: "demo-context",
    rawText: "I need to carve out time for deep work without losing sight of recovery.",
    selectedSpans: ["carve out time", "lose sight of"],
    sourceUrl: null,
    sourceTitle: "本周工作复盘",
    userNote: "想把工作里真正会用到的表达留下来。",
    status: "review",
    createdAt: new Date().toISOString(),
    candidates: [{ id: "demo-candidate", position: 1, candidate: "carve out time", cueZh: "挤出时间", whyUseful: "适合工作与训练安排。", confidence: 0.94, decisionStatus: "pending" }],
  }],
};

const status: SystemStatus = {
  ok: true,
  database: "preview demo",
  timezone: "Asia/Shanghai",
  pendingAiJobs: 1,
  failedSubmissions: 0,
  lastCommittedAt: new Date(Date.now() - 3600000).toISOString(),
  latestImport: { id: "preview", status: "reconciled", sourceSha256: "local-preview", snapshotSha256: "674a50b1…", createdAt: new Date().toISOString() },
};

export const demoApi: ApiClient = {
  async recordQuestionActivity() {return {ok: true};},
  async getPendingAiJobs() {return {ok: true, items: []};},
  async getCandidateBootstrap() { return {ok: true, items: [], readyCount: 0}; },
  async confirmCandidates(decisions) {return {ok: true, count: decisions.length};},
  async getLegacyRecovery() {return {ok: true, items: []};},
  async getReviewBootstrap() {
    return { ...bootstrap, session: bootstrap.session ? { ...bootstrap.session, revision } : null };
  },
  async setQuestionCount(count, mode) { return { ok: true, count, mode, revision: 1 }; },
  async checkpointAnswers(request): Promise<CheckpointResult> {
    revision += 1;
    return { ok: true, sessionId: request.sessionId, revision, checkpointed: request.answers.length, frozenHash: request.frozenHash };
  },
  async submitSession() {
    submissionState = "submitted";
    return { ok: true, submissionId: "00000000-0000-0000-0000-000000000777", status: "submitted", answerHash: "demo-answer-hash", gradeRequestCount: questions.length };
  },
  async getSubmissionStatus(submissionId) {
    return {
      ok: true, submissionId, sessionId: bootstrap.session!.id, status: submissionState,
      answerHash: "demo-answer-hash", revision: 1, errorCode: null, errorDetail: null,
      grades: submissionState === "committed" ? questions.map((question) => ({ position: question.position, result: "normal", feedbackZh: "搭配自然，语义准确。", errorCategory: null, confidence: 0.98, evidence: "accepted collocation", expectedAnswer: question.expectedAnswers[0], observedAnswer: question.expectedAnswers[0], status: "committed", needsConfirmation: false, extraPractice: [] })) : [],
      journal: submissionState === "committed" ? { status: "committed", lastCompletedStep: "readback", readbackStatus: "verified_complete", errorCode: null } : { status: "pending", lastCompletedStep: "grade_requests_frozen", readbackStatus: null, errorCode: null },
    };
  },
  async confirmGrades() { submissionState = "committed"; return { ok: true }; },
  async retrySubmissionCommit() { submissionState = "committed"; return { ok: true }; },
  async submitExtraPractice() { return { ok: true, affectsSrs: false }; },
  async createAiJob(kind): Promise<AiJob> { return { ok: true, jobId: "demo-job", kind, snapshotHash: "demo-snapshot", batchId: "demo-batch", expectedCount: questions.length, status: "prepared" }; },
  async getAiJobPrompt(): Promise<AiJobPrompt> {
    return { ok: true, jobId: "demo-job", kind: "grade_submission", snapshotHash: "demo-snapshot", batchId: "demo-batch", expectedCount: questions.length, status: "prepared", snapshot: questions, prompt: "请严格根据冻结的 Grade Requests 批改。只返回一个 JSON 对象，原样回显 jobId、snapshotHash、batchId、Observed Answer 和 Answer Hash；不要使用 Markdown。" };
  },
  async importAiResult() { submissionState = "committed"; return { ok: true, jobId: "demo-job", status: "consumed", actualCount: questions.length }; },
  async cancelAiJob() { return { ok: true, status: "cancelled" }; },
  async saveContext() { return { ok: true, contextId: crypto.randomUUID(), status: "pending" }; },
  async getContextInbox() { return contexts; },
  async decideContextCandidate() { return { ok: true }; },
  async getDashboard() { return dashboard; },
  async getPhraseLibrary(search) { return { ...library, items: search ? library.items.filter((item) => `${item.chunk} ${item.cueZh}`.toLowerCase().includes(search.toLowerCase())) : library.items }; },
  async getPhraseDetail(phraseId) {
    const phrase = library.items.find((item) => item.id === phraseId) ?? library.items[0];
    return { ok: true, phrase: { ...phrase, commonMistake: null, notes: null, canonicalPattern: phrase.chunk }, stats: { lastReviewedAt: phrase.lastReviewedAt, timesSeen: phrase.timesSeen, timesCorrect: phrase.timesCorrect }, history: [] };
  },
  async getSystemStatus() { return status; },
};
