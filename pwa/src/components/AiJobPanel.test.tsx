import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoApi } from "../lib/demoApi";
import { AiJobPanel } from "./AiJobPanel";
afterEach(cleanup);beforeEach(()=>localStorage.clear());
describe("Manual AI handoff",()=>{
 it("prepares and imports every supported job kind with its subject",async()=>{
  for(const kind of ["context_extract","candidate_generate","question_prepare","grade_submission"] as const){
   const client={...demoApi,createAiJob:vi.fn(demoApi.createAiJob),importAiResult:vi.fn(demoApi.importAiResult)};const imported=vi.fn();const user=userEvent.setup();const view=render(<AiJobPanel api={client} kind={kind} subjectId="subject" onImported={imported}/>);await user.click(screen.getByRole("button",{name:"准备提示词"}));await screen.findByLabelText("粘贴 ChatGPT 返回的 JSON");expect(client.createAiJob).toHaveBeenCalledWith(kind,null,"subject",expect.any(String));await user.click(screen.getByLabelText("粘贴 ChatGPT 返回的 JSON"));await user.paste('{"jobId":"demo-job","items":[]}');await user.click(screen.getByRole("button",{name:"校验并导入"}));await waitFor(()=>expect(imported).toHaveBeenCalledTimes(1));expect(client.importAiResult).toHaveBeenCalledWith("demo-job",{jobId:"demo-job",items:[]});view.unmount();
  }
 });
 it("rejects malformed JSON before sending any mutation",async()=>{
  const client={...demoApi,importAiResult:vi.fn()};const user=userEvent.setup();render(<AiJobPanel api={client} kind="context_extract"/>);await user.click(screen.getByRole("button",{name:"准备提示词"}));await screen.findByLabelText("粘贴 ChatGPT 返回的 JSON");await user.type(screen.getByLabelText("粘贴 ChatGPT 返回的 JSON"),"not json");await user.click(screen.getByRole("button",{name:"校验并导入"}));expect(client.importAiResult).not.toHaveBeenCalled();expect(screen.getByRole("status").textContent).toContain("JSON 格式无效");
 });
 it("resumes a server-side pending job on another device",async()=>{
  const client={...demoApi,getPendingAiJobs:vi.fn(async()=>({ok:true,items:[{ok:true,jobId:"pending",kind:"question_prepare" as const,subjectId:"session",snapshotHash:"hash",batchId:"batch",expectedCount:4,status:"prepared"}]})),getAiJobPrompt:vi.fn(demoApi.getAiJobPrompt)};render(<AiJobPanel api={client} kind="question_prepare" subjectId="session"/>);await screen.findByRole("button",{name:"复制完整提示词"});expect(client.getAiJobPrompt).toHaveBeenCalledWith("pending");
 });
});
