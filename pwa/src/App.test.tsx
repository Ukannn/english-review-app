import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LearningApp } from "./App";
import { demoApi } from "./lib/demoApi";
vi.mock("./lib/recovery",()=>({loadRecovery:vi.fn(async()=>null),syncPendingActivities:vi.fn(async()=>undefined),clearAllRecovery:vi.fn(),saveRecovery:vi.fn(),recordActivity:vi.fn(async()=>undefined)}));
afterEach(cleanup);
beforeEach(()=>{history.replaceState(null,"","/");vi.spyOn(window,"scrollTo").mockImplementation(()=>undefined);});
it("repairs the daily queue before totals and opens the lesson in the shared shell", async () => {
  const calls: string[] = [];
  const client = {...demoApi,getReviewBootstrap:vi.fn(async()=>{calls.push("queue");return demoApi.getReviewBootstrap();}),getDashboard:vi.fn(async()=>{calls.push("dashboard");return demoApi.getDashboard();})};
  render(<LearningApp client={client} demo/>);
  await screen.findByRole("textbox",{name:"你的答案"});
  expect(calls).toEqual(["queue","dashboard"]);
  expect(within(screen.getByRole("navigation",{name:"主导航"})).getAllByRole("button").map(button=>button.textContent)).toEqual(["今日学习","语料","学习报告","学习资料库","同步与设置"]);
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
