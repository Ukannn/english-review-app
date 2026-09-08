export type GradeResult = "forgotten" | "difficult" | "normal" | "mastered";
export type SyncState = "idle" | "syncing" | "locked" | "conflict";

export interface ReviewQuestion {
  id: string;
  position: number;
  phraseId: string | null;
  candidateId: string | null;
  questionType: string | null;
  promptZh: string | null;
  promptEn: string | null;
  expectedAnswers: string[];
  acceptedVariants: string[];
  semanticBoundary: string | null;
  contentHash: string;
  ruleVersion?: string;
  trainingGoal?: string;
  hints?: string[];
  learningCard?: { meaningZh: string; example: string; usageNote?: string; expression?: string } | null;
  isNew?: boolean;
  hintCount?: number;
  learningCardViewed?: boolean;
  draft: {
    answer: string;
    revision: number;
    answerHash: string;
    status: string;
    hintUsed?: boolean;
    hintCount?: number;
    learningCardViewed?: boolean;
  } | null;
}

export interface ReviewBootstrap {
  ok: boolean;
  state: "empty" | "questions_required" | "open" | "submitted" | "grading" | "needs_confirmation" | string;
  learningDate: string;
  queueId?: string;
  actualCount?: number;
  session: {
    id: string;
    revision: number;
    maxQuestions: number;
    status: string;
    submissionId?: string | null;
  } | null;
  questions: ReviewQuestion[];
  settings?: { defaultQuestionCount: number; todayQuestionCount: number; minimumTodayCount: number; revision: number };
}

export interface CheckpointAnswer {
  position: number;
  answer: string;
  revision: number;
  revealHash: string;
  clientInstanceId: string;
  pageStartedAt: string;
  practiceStartedAt?: string;
  practiceEndedAt?: string;
  hintUsed?: boolean;
  hintCount?: number;
  learningCardViewed?: boolean;
}

export interface CheckpointRequest {
  sessionId: string;
  answers: CheckpointAnswer[];
  sessionRevision: number;
  idempotencyKey: string;
  frozenHash: string;
}

export interface CheckpointResult {
  ok: boolean;
  sessionId: string;
  revision: number;
  checkpointed: number;
  frozenHash: string;
}

export interface SubmissionStatus {
  ok: boolean;
  submissionId: string;
  sessionId: string;
  status: "submitted" | "grading" | "needs_confirmation" | "committed" | "rejected" | "failed";
  answerHash: string;
  revision: number;
  errorCode: string | null;
  errorDetail: string | null;
  grades: GradeStatus[];
  journal: {
    status: string;
    lastCompletedStep: string | null;
    readbackStatus: string | null;
    errorCode: string | null;
  } | null;
}

export interface GradeStatus {
  position: number;
  result: GradeResult;
  feedbackZh: string | null;
  errorCategory: string | null;
  confidence: number;
  evidence: string | null;
  expectedAnswer: string | null;
  observedAnswer: string;
  status: string;
  needsConfirmation: boolean;
  extraPractice: ExtraPracticePrompt[];
  targetOutcome?: "correct" | "partial" | "forgotten" | "not_measured";
  meaningOk?: boolean;
  meaningSuccess?: boolean;
  naturalness?: "natural" | "minor_issue" | "major_issue";
  hintUsed?: boolean;
}

export interface ConfirmationDecision {
  position: number;
  decision: "accept" | "reject";
  result?: GradeResult;
  targetOutcome?: "correct" | "partial" | "forgotten" | "not_measured";
  meaningOk?: boolean;
  feedbackZh?: string;
  naturalness?: "natural" | "minor_issue" | "major_issue";
}

export interface ExtraPracticePrompt {
  practiceType?: string;
  prompt?: string;
  promptZh?: string;
  referenceAnswer?: string;
}

export interface AiJob {
  ok: boolean;
  jobId: string;
  subjectId?: string | null;
  kind: "context_extract" | "candidate_generate" | "question_prepare" | "grade_submission";
  snapshotHash: string;
  batchId: string;
  expectedCount: number;
  status: string;
}

export interface AiJobPrompt extends AiJob {
  snapshot: unknown;
  prompt: string;
}

export interface DashboardData {
  ok: boolean;
  learningDate: string;
  today: {
    planned: number;
    completed: number;
    waitingForGrading: number;
  };
  analytics?: LearningAnalytics;
  totals: {
    phrases: number;
    reviews: number;
    accuracy: number;
  };
}

export interface LearningAnalytics {
  ruleVersion: string;
  legacyReviews: number;
  days: Array<{ date: string; durationMinutes: number | null; independentSuccess: number; independentAttempts: number; expressionSuccess: number; expressionAttempts: number; backlog: number | null }>;
}

export interface PhraseSummary {
  id: string;
  chunk: string;
  cueZh: string | null;
  type: string | null;
  topic: string | null;
  difficulty: string | null;
  status: string;
  reviewStage: number;
  nextReviewAt: string | null;
  lastReviewedAt: string | null;
  timesSeen: number;
  timesCorrect: number;
  naturalExample: string | null;
  lastResult: string | null;
}

export interface PhraseLibrary {
  ok: boolean;
  items: PhraseSummary[];
}

export interface PhraseDetail {
  ok: boolean;
  phrase: PhraseSummary & {
    commonMistake: string | null;
    notes: string | null;
    canonicalPattern: string | null;
  };
  stats: {
    lastReviewedAt: string | null;
    timesSeen: number;
    timesCorrect: number;
  };
  history: Array<{
    reviewedAt: string;
    result: GradeResult;
    prompt: string | null;
    userAnswer: string | null;
    expectedAnswer: string | null;
  }>;
}

export interface ContextCandidate {
  id: string;
  position: number;
  candidate: string;
  cueZh: string | null;
  whyUseful: string | null;
  confidence: number | null;
  decisionStatus: string;
}

export interface ContextInbox {
  ok: boolean;
  contexts: Array<{
    id: string;
    rawText: string;
    selectedSpans: unknown[];
    sourceUrl: string | null;
    sourceTitle: string | null;
    userNote: string | null;
    status: string;
    createdAt: string;
    candidates: ContextCandidate[];
  }>;
}

export interface SystemStatus {
  ok: boolean;
  database: string;
  timezone: string;
  pendingAiJobs: number;
  failedSubmissions: number;
  lastCommittedAt: string | null;
  latestImport: {
    id: string;
    status: string;
    sourceSha256: string;
    snapshotSha256: string;
    createdAt: string;
  } | null;
}

export interface CandidateItem {
  id: string; source: "generated" | "context"; candidate: string; cueZh: string | null; whyUseful: string | null; naturalExample: string | null; status: string;
}
export interface CandidateBootstrap { ok: boolean; items: CandidateItem[]; readyCount: number }
export interface CandidateDecision { id: string; source: "generated" | "context"; action: "accept" | "edit" | "reject"; editedCandidate?: string }
export interface LegacyRecovery { ok: boolean; items: Array<{id: string; source: string; status: string; createdAt: string; content: unknown}> }

export interface ApiClient {
  recordQuestionActivity(sessionId: string, position: number, action: "hint" | "study" | "reveal", idempotencyKey: string): Promise<{ok: boolean}>;
  getPendingAiJobs(): Promise<{ok: boolean; items: AiJob[]}>;
  getCandidateBootstrap(): Promise<CandidateBootstrap>;
  confirmCandidates(decisions: CandidateDecision[], idempotencyKey: string): Promise<{ok: boolean; count: number}>;
  getLegacyRecovery(): Promise<LegacyRecovery>;
  getReviewBootstrap(): Promise<ReviewBootstrap>;
  setQuestionCount(count: number, mode: "today" | "default" | "both", revision: number | null, idempotencyKey: string): Promise<{ ok: boolean; count: number; mode: string; revision: number; actualCount?: number; defaultCount?: number; minimumCount?: number }>;
  checkpointAnswers(request: CheckpointRequest): Promise<CheckpointResult>;
  submitSession(request: CheckpointRequest): Promise<{ ok: boolean; submissionId: string; status: string; answerHash: string; gradeRequestCount: number }>;
  getSubmissionStatus(submissionId: string): Promise<SubmissionStatus>;
  confirmGrades(submissionId: string, decisions: ConfirmationDecision[], revision: number, idempotencyKey: string, frozenHash: string): Promise<unknown>;
  retrySubmissionCommit(submissionId: string, revision: number, idempotencyKey: string): Promise<unknown>;
  submitExtraPractice(submissionId: string, phraseId: string | null, practiceType: string, prompt: string, answer: string, referenceAnswer: string | null, idempotencyKey: string): Promise<unknown>;
  createAiJob(kind: AiJob["kind"], requestedCount?: number | null, subjectId?: string | null, idempotencyKey?: string): Promise<AiJob>;
  getAiJobPrompt(jobId: string): Promise<AiJobPrompt>;
  importAiResult(jobId: string, payload: unknown): Promise<{ ok: boolean; jobId: string; status: string; actualCount: number }>;
  cancelAiJob(jobId: string): Promise<unknown>;
  saveContext(payload: Record<string, unknown>, revision: number | null, idempotencyKey: string): Promise<unknown>;
  getContextInbox(): Promise<ContextInbox>;
  decideContextCandidate(candidateId: string, action: "accept" | "edit" | "reject", editedCandidate: string | null, idempotencyKey: string): Promise<unknown>;
  getDashboard(): Promise<DashboardData>;
  getPhraseLibrary(search?: string | null, limit?: number, offset?: number): Promise<PhraseLibrary>;
  getPhraseDetail(phraseId: string): Promise<PhraseDetail>;
  getSystemStatus(): Promise<SystemStatus>;
}
