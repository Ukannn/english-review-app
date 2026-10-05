import type { CheckpointAnswer, ReviewBootstrap } from "./contracts";
import type { RecoveryState } from "./recovery";

// Cloud checkpoints are authoritative; unsynced answers and unrevealed input stay local.
export function mergeLessonRecovery(bootstrap: ReviewBootstrap, local: RecoveryState | null) {
  const answers = new Map<number, CheckpointAnswer>();
  const checkpointed = new Set<number>();
  const hintCounts = {...local?.hintCounts};
  const learned = new Set(local?.learnedPositions);
  const inputs = {...local?.lessonWork?.inputs};
  const seconds = {...local?.lessonWork?.seconds};
  const conflictingAnswers: CheckpointAnswer[] = [];
  const localAnswers = new Map(local?.answers.map(answer => [answer.position, answer]));
  for (const question of bootstrap.questions) {
    const draft = question.draft;
    hintCounts[question.position] = Math.max(hintCounts[question.position] ?? 0, question.hintCount ?? 0, draft?.hintCount ?? 0);
    if (question.learningCardViewed || draft?.learningCardViewed) learned.add(question.position);
    if (!draft) continue;
    const cloud: CheckpointAnswer = {position: question.position, answer: draft.answer, revision: draft.revision,
      revealHash: draft.answerHash, activeSeconds: draft.activeSeconds ?? 0, attemptState: draft.attemptState ?? "answered",
      hintUsed: draft.hintUsed ?? false, hintCount: draft.hintCount ?? 0, learningCardViewed: draft.learningCardViewed ?? false,
      clientInstanceId: "cloud-recovery", pageStartedAt: new Date().toISOString()};
    answers.set(question.position, cloud);
    checkpointed.add(question.position);
    seconds[String(question.position)] = Math.max(seconds[String(question.position)] ?? 0, draft.activeSeconds ?? 0);
    const pending = localAnswers.get(question.position);
    if (pending && (pending.answer !== cloud.answer || (pending.attemptState ?? "answered") !== cloud.attemptState)) {
      conflictingAnswers.push(pending);
    } else if (!pending && inputs[question.position]?.trim() && inputs[question.position].trim() !== cloud.answer) {
      conflictingAnswers.push({...cloud, answer: inputs[question.position], clientInstanceId: "unsubmitted-input"});
    }
  }
  for (const answer of localAnswers.values()) if (!answers.has(answer.position)) answers.set(answer.position, answer);
  seconds.reading = Math.max(seconds.reading ?? 0, bootstrap.lesson?.readingSeconds ?? 0);
  return {answers, checkpointed, hintCounts, learnedPositions: [...learned], inputs, seconds, conflictingAnswers,
    sessionRevision: Math.max(bootstrap.session!.revision, local?.sessionRevision ?? 0)};
}
