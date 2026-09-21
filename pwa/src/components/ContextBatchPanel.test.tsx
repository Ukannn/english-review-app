import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { demoApi } from "../lib/demoApi";
import { ContextBatchPanel } from "./ContextBatchPanel";
import { CHATGPT_COMMAND } from "./AiJobPanel";
import type { AiJob } from "../lib/contracts";
afterEach(cleanup);
const job = (id: string): AiJob => ({ok:true,jobId:`job-${id}`,subjectId:id,kind:"context_extract",snapshotHash:"hash",batchId:"batch",expectedCount:6,status:"prepared"});
it("prepares every pending context with one click, reuses existing work and copies once", async () => {
  const api={...demoApi,getPendingAiJobs:vi.fn(async()=>({ok:true,items:[job("a")]})),createAiJob:vi.fn(async(_kind:AiJob["kind"],_count?:number|null,id?:string|null)=>job(id!))};
  const user=userEvent.setup();
  render(<ContextBatchPanel api={api} contextIds={["a","b","c"]} onRefresh={vi.fn(async()=>{})}/>);
  const button=await screen.findByRole("button",{name:"整理剩余 2 条语料"});
  await waitFor(()=>expect((button as HTMLButtonElement).disabled).toBe(false));
  await user.click(button);
  await screen.findByText("已有 3 条语料等待 ChatGPT 处理。");
  expect(api.createAiJob.mock.calls.map(call=>call[2])).toEqual(["b","c"]);
  await user.click(screen.getByRole("button",{name:"复制给 ChatGPT"}));
  expect(await navigator.clipboard.readText()).toBe(CHATGPT_COMMAND);
});
it("keeps successful tasks and retries failed work with the same key", async () => {
  const pending:AiJob[]=[];
  let fail=true;
  const api={...demoApi,getPendingAiJobs:vi.fn(async()=>({ok:true,items:[...pending]})),createAiJob:vi.fn(async(_kind:AiJob["kind"],_count?:number|null,id?:string|null,_key?:string)=>{
    if(id==="b"&&fail){fail=false;throw new Error("offline");}
    const created=job(id!);pending.push(created);return created;
  })};
  const user=userEvent.setup();render(<ContextBatchPanel api={api} contextIds={["a","b","c"]} onRefresh={vi.fn(async()=>{})}/>);
  const button=await screen.findByRole("button",{name:"一次整理全部 3 条语料"});
  await waitFor(()=>expect((button as HTMLButtonElement).disabled).toBe(false));
  await user.click(button);await screen.findByText(/1 条语料准备失败/);
  await user.click(screen.getByRole("button",{name:"整理剩余 1 条语料"}));
  await screen.findByText("已有 3 条语料等待 ChatGPT 处理。");
  expect(api.createAiJob.mock.calls.map(call=>call[2])).toEqual(["a","b","c","b"]);
  expect(api.createAiJob.mock.calls[1]![3]).toBe(api.createAiJob.mock.calls[3]![3]);
});
