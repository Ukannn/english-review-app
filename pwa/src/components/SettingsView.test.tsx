import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { demoApi } from "../lib/demoApi";
import { SettingsView } from "./SettingsView";
vi.mock("../lib/recovery",()=>({loadRecovery:vi.fn(async()=>null),syncPendingActivities:vi.fn(async()=>undefined)}));
vi.mock("./PasswordForm",()=>({PasswordForm:()=>null}));
afterEach(cleanup);
describe("Question settings",()=>{
 it("keeps learning amount exact and confirms only an acknowledged save",async()=>{
  const data=structuredClone(await demoApi.getReviewBootstrap());data.ruleVersion="english_v3";data.settings={defaultQuestionCount:8,todayQuestionCount:8,minimumTodayCount:1,revision:17};
  let acknowledge!:(value:unknown)=>void;
  const api={...demoApi,getReviewBootstrap:vi.fn(async()=>data),setLearningSettings:vi.fn(()=>new Promise<any>(resolve=>{acknowledge=resolve;}))};
  const user=userEvent.setup();render(<SettingsView client={api} demo onSignOut={async()=>undefined} onChanged={async()=>undefined}/>);
  const input=await screen.findByLabelText("以后的独立复习项数");
  await user.click(screen.getByRole("button",{name:"以后的独立复习项数加一"}));
  expect((input as HTMLInputElement).value).toBe("9");
  await user.click(screen.getByRole("button",{name:"保存以后的学习量"}));
  expect((screen.getByRole("button",{name:"正在保存…"}) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button",{name:"已保存"})).toBeNull();
  await act(async()=>acknowledge({ok:true}));
  expect(api.setLearningSettings).toHaveBeenCalledWith(9,17,expect.any(String));
  expect(screen.getByRole("button",{name:"已保存"})).toBeTruthy();
  await user.click(screen.getByRole("button",{name:"以后的独立复习项数减一"}));
  expect((input as HTMLInputElement).value).toBe("8");
  expect(screen.getByRole("button",{name:"保存以后的学习量"})).toBeTruthy();
 });
 it("sends both scopes atomically with the current settings revision",async()=>{
  const data=structuredClone(await demoApi.getReviewBootstrap());data.settings={defaultQuestionCount:12,todayQuestionCount:12,minimumTodayCount:3,revision:17};
  const api={...demoApi,getReviewBootstrap:vi.fn(async()=>data),setQuestionCount:vi.fn(async()=>({ok:true,count:20,mode:"both",revision:18,actualCount:7}))};
  const user=userEvent.setup();render(<SettingsView client={api} demo={true} onSignOut={async()=>undefined} onChanged={async()=>undefined}/>);await screen.findByText(/今日可调整下限 3/);await user.clear(screen.getByLabelText("题量"));await user.type(screen.getByLabelText("题量"),"20");await user.click(screen.getByLabelText("今天和以后"));await user.click(screen.getByRole("button",{name:"保存题量"}));await waitFor(()=>expect(api.setQuestionCount).toHaveBeenCalledWith(20,"both",17,expect.any(String)));expect((await screen.findByRole("status")).textContent).toContain("实际安排 7 题");
 });
 it("keeps future default editable when today's submission is frozen",async()=>{
  const data=structuredClone(await demoApi.getReviewBootstrap());data.session!.submissionId="submitted";data.state="submitted";const api={...demoApi,getReviewBootstrap:vi.fn(async()=>data)};render(<SettingsView client={api} demo={true} onSignOut={async()=>undefined} onChanged={async()=>undefined}/>);await screen.findByText("今天的批次已提交，仍可修改以后默认题量。");expect((screen.getByLabelText("仅今天")as HTMLInputElement).disabled).toBe(true);expect((screen.getByLabelText("以后默认")as HTMLInputElement).disabled).toBe(false);
 });
});
