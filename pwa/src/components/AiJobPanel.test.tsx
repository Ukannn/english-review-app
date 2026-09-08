import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoApi } from "../lib/demoApi";
import { AiJobPanel, CHATGPT_COMMAND } from "./AiJobPanel";
import type { AiJobPrompt } from "../lib/contracts";
afterEach(() => { cleanup(); vi.useRealTimers(); });
beforeEach(() => localStorage.clear());
const pending: AiJobPrompt = { ok:true,jobId:"pending",kind:"question_prepare",subjectId:"session",snapshotHash:"hash",batchId:"batch",expectedCount:4,status:"prepared",snapshot:[],prompt:"private frozen contract" };
const clientFor = () => ({...demoApi, getPendingAiJobs:vi.fn(async()=>({ok:true,items:[pending]})), getAiJobPrompt:vi.fn(async()=>pending), importAiResult:vi.fn(demoApi.importAiResult)});
describe("Connected ChatGPT handoff", () => {
  it("prepares each job and copies only the short command, without a manual import", async () => {
    for (const kind of ["context_extract","candidate_generate","question_prepare","grade_submission"] as const) {
      const api={...demoApi,getPendingAiJobs:vi.fn(async()=>({ok:true,items:[]})),createAiJob:vi.fn(demoApi.createAiJob),importAiResult:vi.fn(demoApi.importAiResult)};
      const done=vi.fn(); const user=userEvent.setup(); const view=render(<AiJobPanel api={api} kind={kind} subjectId="subject" onImported={done}/>);
      await waitFor(()=>expect((screen.getByRole("button",{name:"准备 AI 处理"}) as HTMLButtonElement).disabled).toBe(false));
      await user.click(screen.getByRole("button",{name:"准备 AI 处理"}));
      await user.click(await screen.findByRole("button",{name:"复制给 ChatGPT"}));
      expect(await navigator.clipboard.readText()).toBe(CHATGPT_COMMAND);
      expect(api.createAiJob).toHaveBeenCalledWith(kind,null,"subject",expect.any(String));
      expect(screen.getAllByRole("textbox")).toHaveLength(1);
      expect((screen.getByRole("textbox") as HTMLTextAreaElement).readOnly).toBe(true);
      expect(screen.queryByText(/JSON/)).toBeNull();
      expect(api.importAiResult).not.toHaveBeenCalled(); expect(done).not.toHaveBeenCalled();
      view.unmount(); localStorage.clear();
    }
  });
  it("recovers a pending job on another device and refreshes once when the server completes it", async () => {
    vi.useFakeTimers();
    const api=clientFor(); const done=vi.fn();
    await act(async()=>{render(<AiJobPanel api={api} kind="question_prepare" subjectId="session" onImported={done}/>);});
    expect(screen.getByRole("button",{name:"复制给 ChatGPT"})).toBeTruthy();
    expect(api.getAiJobPrompt).toHaveBeenCalledWith("pending");
    api.getAiJobPrompt.mockResolvedValue({...pending,status:"consumed"});
    await act(async()=>{await vi.advanceTimersByTimeAsync(10000);});
    expect(done).toHaveBeenCalledTimes(1); expect(screen.queryByRole("button",{name:"复制给 ChatGPT"})).toBeNull();
    await act(async()=>{await vi.advanceTimersByTimeAsync(30000);});
    expect(done).toHaveBeenCalledTimes(1); expect(localStorage.getItem("english-review:ai-job:question_prepare:session")).toBeNull();
  });
  it("refreshes on return from ChatGPT and preserves pending work after a failed check", async () => {
    const api=clientFor(); const done=vi.fn(); render(<AiJobPanel api={api} kind="question_prepare" subjectId="session" onImported={done}/>);
    await screen.findByRole("button",{name:"复制给 ChatGPT"});
    api.getAiJobPrompt.mockRejectedValueOnce(new Error("offline"));
    fireEvent.focus(window); await screen.findByText("状态检查失败：offline");
    expect(done).not.toHaveBeenCalled(); expect(localStorage.getItem("english-review:ai-job:question_prepare:session")).toBe("pending");
    api.getAiJobPrompt.mockResolvedValue({...pending,status:"consumed"});
    fireEvent.focus(window); await waitFor(()=>expect(done).toHaveBeenCalledTimes(1));
  });
  it("does not deliver a late completion to a different subject", async () => {
    let resolve!:(value:AiJobPrompt)=>void;
    const api=clientFor();const done=vi.fn();const view=render(<AiJobPanel api={api} kind="question_prepare" subjectId="session" onImported={done}/>);
    await screen.findByRole("button",{name:"复制给 ChatGPT"});
    api.getAiJobPrompt.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
    fireEvent.focus(window);
    view.rerender(<AiJobPanel api={api} kind="question_prepare" subjectId="other" onImported={done}/>);
    await act(async()=>{resolve({...pending,status:"consumed"});});
    expect(done).not.toHaveBeenCalled(); expect(screen.queryByText("处理完成，内容已保存。")).toBeNull();
  });
  it("reads back cancellation and creates a new idempotency key for retry", async () => {
    const api={...clientFor(),cancelAiJob:vi.fn(demoApi.cancelAiJob),createAiJob:vi.fn(demoApi.createAiJob)};
    const user=userEvent.setup();render(<AiJobPanel api={api} kind="question_prepare" subjectId="session"/>);
    await screen.findByRole("button",{name:"复制给 ChatGPT"});
    api.getAiJobPrompt.mockResolvedValueOnce({...pending,status:"cancelled"});
    await user.click(screen.getByRole("button",{name:"取消处理"}));
    await user.click(await screen.findByRole("button",{name:"准备 AI 处理"}));
    expect(api.cancelAiJob).toHaveBeenCalledWith("pending");expect(api.createAiJob).toHaveBeenCalledTimes(1);
  });
});
