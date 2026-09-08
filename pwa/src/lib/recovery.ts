import { del, get, set, keys, delMany } from "idb-keyval";
import type { ApiClient, CheckpointAnswer } from "./contracts";

export interface RecoveryState {
  sessionId: string;
  sessionRevision: number;
  answers: CheckpointAnswer[];
  checkpointedPositions: number[];
  updatedAt: string;
  hintCounts?: Record<number, number>;
  learnedPositions?: number[];
}
const key = (sessionId: string) => `english-review:v1:${sessionId}`;
export async function loadRecovery(sessionId: string): Promise<RecoveryState | null> {
  // Unsynced answers must not expire silently; cleanup occurs after submission or explicit logout.
  return await get<RecoveryState>(key(sessionId)) ?? null;
}
export async function saveRecovery(state: RecoveryState): Promise<void> { await set(key(state.sessionId), state); }
export async function clearRecovery(sessionId: string): Promise<void> { await del(key(sessionId)); }
export async function clearAllRecovery(): Promise<void> {
  const all = await keys();
  await delMany(all.filter(item => typeof item === "string" && item.startsWith("english-review:")));
  for (const storageKey of Object.keys(localStorage)) if (storageKey.startsWith("english-review:")) localStorage.removeItem(storageKey);
}
interface PendingActivity { sessionId: string; position: number; action: "hint" | "study" | "reveal"; idempotencyKey: string }
export async function recordActivity(client: ApiClient, sessionId: string, position: number, action: PendingActivity["action"], ordinal = 1): Promise<void> {
  const idempotencyKey = `activity:${sessionId}:${position}:${action}:${ordinal}`;
  const storageKey = `english-review:activity:${idempotencyKey}`;
  const activity = { sessionId, position, action, idempotencyKey };
  await set(storageKey, activity);
  try { await client.recordQuestionActivity(sessionId, position, action, idempotencyKey); await del(storageKey); }
  catch { /* Remains queued; sync must succeed before changing today's count or submitting. */ }
}
export async function syncPendingActivities(client: ApiClient): Promise<void> {
  const activityKeys = (await keys()).filter(item => typeof item === "string" && item.startsWith("english-review:activity:"));
  for (const storageKey of activityKeys) {
    const item = await get<PendingActivity>(storageKey);
    if (!item) continue;
    await client.recordQuestionActivity(item.sessionId, item.position, item.action, item.idempotencyKey);
    await del(storageKey);
  }
}
