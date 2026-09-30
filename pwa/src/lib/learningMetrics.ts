import type { ApiClient, DashboardData, PhraseSummary } from "./contracts";
import { addLearningDays, learningDateAt } from "./learningDate";

export type ExpressionLayer = "unlearned" | "consolidating" | "longInterval";
export const expressionLayers = [
  { key: "longInterval", label: "长间隔复习", note: "已到复习阶段 5–7，其基准间隔为 30、60、120 天；最近兼容结果未标为困难或遗忘。未测到目标时，实际复习日期仍可能缩短。它表示进度，不保证永久掌握。" },
  { key: "consolidating", label: "巩固中", note: "已有练习记录，尚未进入上述长间隔阶段，或最近仍遇到困难。" },
  { key: "unlearned", label: "未学", note: "已收录但还没有已记录的 SRS 练习；尚未确认的候选不计入总量。" },
] as const;

export function expressionLayer(p: PhraseSummary): ExpressionLayer {
  if (p.timesSeen === 0 && !p.lastReviewedAt) return "unlearned";
  if (p.reviewStage >= 5 && p.reviewStage <= 7 && p.lastResult !== "forgotten" && p.lastResult !== "difficult") return "longInterval";
  return "consolidating";
}

export async function readPhraseInventory(client: ApiClient, cancelled: () => boolean = () => false): Promise<PhraseSummary[]> {
  const items = new Map<string, PhraseSummary>();
  const limit = 100;
  for (let offset = 0; ; offset += limit) {
    if (cancelled()) return [];
    const page = await client.getPhraseLibrary(null, limit, offset);
    if (!page.ok) throw new Error("表达统计暂时无法读取。");
    const before = items.size;
    for (const item of page.items) items.set(item.id, item);
    if (page.items.length < limit) return [...items.values()];
    if (items.size === before) throw new Error("分页结果重复，无法确认全量；请重新读取。");
  }
}

export function dueSchedule(items: PhraseSummary[], today: string, count: 7 | 30) {
  const days = Array.from({ length: count }, (_, i) => ({ date: addLearningDays(today, i + 1), count: 0 }));
  const byDay = new Map(days.map(d => [d.date, d]));
  let backlog = 0, unscheduled = 0;
  for (const item of items) {
    if (!["active", "mastered"].includes(item.status)) continue;
    const date = item.nextReviewAt ? learningDateAt(item.nextReviewAt) : "";
    if (!date) { unscheduled++; continue; }
    if (date <= today) backlog++;
    const bin = byDay.get(date);
    if (bin) bin.count++;
  }
  return { days, backlog, unscheduled, total: days.reduce((n, d) => n + d.count, 0) };
}

export function reportDays(dashboard: DashboardData) {
  const v3 = dashboard.v3 && (dashboard.v3.completedLessons > 0 || dashboard.v3.days.some(d => d.attempts > 0));
  return { version: v3 ? "english_v3" : dashboard.analytics?.ruleVersion ?? "english_v2", days: [...(v3 ? dashboard.v3!.days : dashboard.analytics?.days ?? [])].sort((a, b) => a.date.localeCompare(b.date)), v3: Boolean(v3) };
}

export const rate = (success: number, attempts: number) => attempts > 0 ? `${Math.round(success / attempts * 100)}%` : "暂无记录";
