import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LearningApp } from "./App";
import { demoApi } from "./lib/demoApi";
import { designDemoApi } from "./lib/designDemo";
vi.mock("./lib/recovery",()=>({loadRecovery:vi.fn(async()=>null),syncPendingActivities:vi.fn(async()=>undefined),clearAllRecovery:vi.fn(),saveRecovery:vi.fn(),recordActivity:vi.fn(async()=>undefined)}));
afterEach(cleanup);
beforeEach(()=>{history.replaceState(null,"","/");vi.spyOn(window,"scrollTo").mockImplementation(()=>undefined);});
it("repairs the daily queue before totals and opens the lesson in the shared shell", async () => {
  const calls: string[] = [];
  const client = {...demoApi,getReviewBootstrap:vi.fn(async()=>{calls.push("queue");return demoApi.getReviewBootstrap();}),getDashboard:vi.fn(async()=>{calls.push("dashboard");return demoApi.getDashboard();})};
  render(<LearningApp client={client} demo/>);
  await screen.findByRole("textbox",{name:"你的答案"});
  expect(calls).toEqual(["queue","dashboard"]);
  expect(within(screen.getByRole("navigation",{name:"主导航"})).getAllByRole("button").map(button=>button.textContent)).toEqual(["今日学习","语料","学习报告","学习记录","学习资料库","同步与设置"]);
  expect(screen.getAllByRole("main")).toHaveLength(1);
});
it("preserves an unrevealed answer when navigating to a report and back",async()=>{
  const user=userEvent.setup();render(<LearningApp client={demoApi} demo/>);
  await user.type(await screen.findByRole("textbox",{name:"你的答案"}),"my unfinished answer");
  const nav=within(screen.getByRole("navigation",{name:"主导航"}));
  await user.click(nav.getByRole("button",{name:"学习报告"}));
  expect(await screen.findByRole("heading",{level:1,name:"学习报告"})).toBeTruthy();
  expect(location.hash).toBe("#analytics");
  expect(screen.queryByRole("textbox",{name:"你的答案"})).toBeNull();
  await user.click(nav.getByRole("button",{name:"今日学习"}));
  expect((screen.getByRole("textbox",{name:"你的答案"}) as HTMLTextAreaElement).value).toBe("my unfinished answer");
});
it("opens direct report routes without presenting a lesson as the active page",async()=>{
  history.replaceState(null,"","/#analytics");render(<LearningApp client={demoApi} demo/>);
  expect(await screen.findByRole("heading",{level:1,name:"学习报告"})).toBeTruthy();
  expect(screen.queryByRole("textbox",{name:"你的答案"})).toBeNull();
});
it("keeps an expression, search and date when leaving records and returning", async () => {
  history.replaceState(null,"","/#history?phrase=preview-phrase-3&date=2026-09-30");
  const user = userEvent.setup();
  const getPhraseDetail = vi.fn(designDemoApi.getPhraseDetail);
  render(<LearningApp client={{ ...designDemoApi, getPhraseDetail }} demo/>);
  expect(await screen.findByRole("heading", { name: "set aside time" })).toBeTruthy();
  await user.type(screen.getByRole("textbox", { name: "搜索记录中的表达" }), "set aside");
  const nav = within(screen.getByRole("navigation", { name: "主导航" }));
  await user.click(nav.getByRole("button", { name: "学习报告" }));
  await user.click(nav.getByRole("button", { name: "学习记录" }));
  expect((screen.getByRole("textbox", { name: "搜索记录中的表达" }) as HTMLInputElement).value).toBe("set aside");
  expect((screen.getByLabelText("筛选这个表达的学习日期") as HTMLInputElement).value).toBe("2026-09-30");
  expect(screen.getByRole("heading", { name: "set aside time" })).toBeTruthy();
  expect(location.hash).toContain("phrase=preview-phrase-3");
  expect(getPhraseDetail).toHaveBeenCalledTimes(1);
});
it("rejects a feedback response from a different session", async () => {
  const client = { ...designDemoApi, getSubmissionStatus: vi.fn(async () => ({ ...await designDemoApi.getSubmissionStatus("preview-submission"), sessionId: "another-session" })) };
  render(<LearningApp client={client} demo/>);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "反馈与当前会话不一致，请重新加载。");
  expect(screen.queryByRole("region", { name: "本次重点回看" })).toBeNull();
});
it("clears an old expression when a report opens records with only a date", async () => {
  history.replaceState(null,"","/#history?phrase=preview-phrase-3");
  const user = userEvent.setup();
  render(<LearningApp client={designDemoApi} demo/>);
  await screen.findByRole("heading", { name: "set aside time" });
  const nav = within(screen.getByRole("navigation", { name: "主导航" }));
  await user.click(nav.getByRole("button", { name: "学习报告" }));
  await user.click(screen.getByRole("button", { name: "查阅当天表达历史" }));
  expect(await screen.findByRole("heading", { name: "选一个表达，查看原答" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "set aside time" })).toBeNull();
  expect(location.hash).toBe("#history?date=2026-09-30");
});
