import { expect, it, vi } from "vitest";
import { demoApi } from "./demoApi";
import { designDemoApi } from "./designDemo";
import { dueSchedule, expressionLayer, readPhraseInventory, reportDays } from "./learningMetrics";
import { formatLearningTime, learningDateAt } from "./learningDate";

it("reads every page and counts each expression once", async () => {
  const client = { ...designDemoApi, getPhraseLibrary: vi.fn(designDemoApi.getPhraseLibrary) };
  const items = await readPhraseInventory(client);
  expect(items.length).toBe(125);
  expect(client.getPhraseLibrary.mock.calls.map(c => c.slice(1))).toEqual([[100, 0], [100, 100]]);
});
it("rejects a backend that silently repeats its first full page", async () => {
  const page = await designDemoApi.getPhraseLibrary(null, 100, 0);
  await expect(readPhraseInventory({ ...demoApi, getPhraseLibrary: async () => page })).rejects.toThrow("分页结果重复");
});
it("uses SRS progress rather than a stale mastered flag", async () => {
  const [p] = (await designDemoApi.getPhraseLibrary()).items;
  expect(expressionLayer({ ...p, status: "mastered", reviewStage: 0, timesSeen: 10, lastReviewedAt: "2026-09-30T00:00:00Z", lastResult: "forgotten" })).toBe("consolidating");
  expect(expressionLayer({ ...p, reviewStage: 5, timesSeen: 10, lastReviewedAt: "2026-09-30T00:00:00Z", lastResult: "normal" })).toBe("longInterval");
  expect(expressionLayer({ ...p, timesSeen: 0, lastReviewedAt: null })).toBe("unlearned");
});
it("separates backlog from future days using Shanghai boundaries", async () => {
  const [p] = (await designDemoApi.getPhraseLibrary()).items;
  const schedule = dueSchedule([
    { ...p, nextReviewAt: "2026-09-30T15:59:59Z" },
    { ...p, nextReviewAt: "2026-09-30T16:00:00Z" },
    { ...p, nextReviewAt: "2026-10-07T16:00:00Z" },
    { ...p, nextReviewAt: null },
  ], "2026-09-30", 7);
  expect(schedule.backlog).toBe(1);
  expect(schedule.total).toBe(1);
  expect(schedule.days[0]).toEqual({ date: "2026-10-01", count: 1 });
  expect(schedule.unscheduled).toBe(1);
});
it("formats a date-only learning day without shifting it and timestamps in Shanghai", () => {
  expect(learningDateAt("2026-09-29")).toBe("2026-09-29");
  expect(learningDateAt("2026-09-29T16:00:00Z")).toBe("2026-09-30");
  expect(formatLearningTime("2026-09-29T16:00:00Z")).toContain("2026/9/30");
});
it("keeps old and new scoring versions out of the same curve", async () => {
  const dashboard = await designDemoApi.getDashboard();
  dashboard.analytics!.days.push({ date: "2026-09-20", independentAttempts: 999, independentSuccess: 999, expressionAttempts: 0, expressionSuccess: 0, durationMinutes: null, backlog: 0 });
  const report = reportDays(dashboard);
  expect(report.version).toBe("english_v3");
  expect(report.days.some(d => d.independentAttempts === 999)).toBe(false);
});
