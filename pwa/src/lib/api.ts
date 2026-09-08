import { createClient, type Session } from "@supabase/supabase-js";
import type {
  AiJob,
  AiJobPrompt,
  ApiClient,
  CheckpointRequest,
  CheckpointResult,
  ConfirmationDecision,
  ContextInbox,
  DashboardData,
  PhraseDetail,
  PhraseLibrary,
  ReviewBootstrap,
  SubmissionStatus,
  SystemStatus,
} from "./contracts";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

function configuredClient() {
  if (!url || !key) return null;
  try {
    const parsed = new URL(url);
    if (!["https:", "http:"].includes(parsed.protocol)) return null;
    return createClient(url, key, {
      auth: { storageKey: "english-learning-lab-auth", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      db: { schema: "english_api" },
    });
  } catch { return null; }
}
export const supabase = configuredClient();
export const hasSupabaseConfig = Boolean(supabase);

async function rpc<T>(name: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error("SUPABASE_NOT_CONFIGURED");
  const { data, error } = await supabase.schema("english_api").rpc(name as never, params as never);
  if (error) {
    const code = [error.code, error.message].filter(Boolean).join(": ");
    throw new Error(code || "RPC_FAILED");
  }
  return data as T;
}

export const api: ApiClient = {
  recordQuestionActivity: (sessionId, position, action, idempotencyKey) => rpc("record_question_activity", {p_session_id: sessionId, p_position: position, p_action: action, p_idempotency_key: idempotencyKey}),
  getPendingAiJobs: () => rpc("get_pending_ai_jobs"),
  getCandidateBootstrap: () => rpc("get_candidate_bootstrap"),
  confirmCandidates: (decisions, idempotencyKey) => rpc("confirm_candidates", {p_decisions: decisions, p_idempotency_key: idempotencyKey}),
  getLegacyRecovery: () => rpc("get_legacy_recovery"),
  getReviewBootstrap: () => rpc<ReviewBootstrap>("get_review_bootstrap"),
  setQuestionCount: (count, mode, revision, idempotencyKey) => rpc("set_question_count", { p_count: count, p_mode: mode, p_revision: revision, p_idempotency_key: idempotencyKey }),
  checkpointAnswers: (request: CheckpointRequest) => rpc<CheckpointResult>("checkpoint_answers", { p_session_id: request.sessionId, p_answers: request.answers, p_session_revision: request.sessionRevision, p_idempotency_key: request.idempotencyKey, p_frozen_hash: request.frozenHash }),
  submitSession: (request: CheckpointRequest) => rpc("submit_session", { p_session_id: request.sessionId, p_answers: request.answers, p_session_revision: request.sessionRevision, p_idempotency_key: request.idempotencyKey, p_frozen_hash: request.frozenHash }),
  getSubmissionStatus: (submissionId) => rpc<SubmissionStatus>("get_submission_status", { p_submission_id: submissionId }),
  confirmGrades: (submissionId: string, decisions: ConfirmationDecision[], revision: number, idempotencyKey: string, frozenHash: string) => rpc("confirm_grades", { p_submission_id: submissionId, p_decisions: decisions, p_revision: revision, p_idempotency_key: idempotencyKey, p_frozen_hash: frozenHash }),
  retrySubmissionCommit: (submissionId, revision, idempotencyKey) => rpc("retry_submission_commit", { p_submission_id: submissionId, p_revision: revision, p_idempotency_key: idempotencyKey }),
  submitExtraPractice: (submissionId, phraseId, practiceType, prompt, answer, referenceAnswer, idempotencyKey) => rpc("submit_extra_practice", { p_submission_id: submissionId, p_phrase_id: phraseId, p_practice_type: practiceType, p_prompt: prompt, p_answer: answer, p_reference_answer: referenceAnswer, p_idempotency_key: idempotencyKey }),
  createAiJob: (kind, requestedCount = null, subjectId = null, idempotencyKey = crypto.randomUUID()) => rpc<AiJob>("create_ai_job", { p_kind: kind, p_requested_count: requestedCount, p_subject_id: subjectId, p_idempotency_key: idempotencyKey }),
  getAiJobPrompt: (jobId) => rpc<AiJobPrompt>("get_ai_job_prompt", { p_job_id: jobId }),
  importAiResult: (jobId, payload) => rpc("import_ai_result", { p_job_id: jobId, p_payload: payload }),
  cancelAiJob: (jobId) => rpc("cancel_ai_job", { p_job_id: jobId }),
  saveContext: (payload, revision, idempotencyKey) => rpc("save_context", { p_payload: payload, p_revision: revision, p_idempotency_key: idempotencyKey }),
  getContextInbox: () => rpc<ContextInbox>("get_context_inbox"),
  decideContextCandidate: (candidateId, action, editedCandidate, idempotencyKey) => rpc("decide_context_candidate", { p_candidate_id: candidateId, p_action: action, p_edited_candidate: editedCandidate, p_idempotency_key: idempotencyKey }),
  getDashboard: () => rpc<DashboardData>("get_dashboard"),
  getPhraseLibrary: (search = null, limit = 100, offset = 0) => rpc<PhraseLibrary>("get_phrase_library", { p_search: search, p_limit: limit, p_offset: offset }),
  getPhraseDetail: (phraseId) => rpc<PhraseDetail>("get_phrase_detail", { p_phrase_id: phraseId }),
  getSystemStatus: () => rpc<SystemStatus>("get_system_status"),
};

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}
