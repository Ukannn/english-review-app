import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoApi } from "../lib/demoApi";
import { loadRecovery, recordActivity } from "../lib/recovery";
import { ReviewView } from "./ReviewView";
import type { ApiClient, CheckpointAnswer, ReviewBootstrap } from "../lib/contracts";
vi.mock("../lib/recovery",()=>({loadRecovery:vi.fn(async()=>null),saveRecovery:vi.fn(async()=>undefined),clearRecovery:vi.fn(async()=>undefined),recordActivity:vi.fn(async()=>undefined),syncPendingActivities:vi.fn(async()=>undefined)}));
afterEach(cleanup);
beforeEach(()=>{vi.restoreAllMocks();vi.mocked(loadRecovery).mockResolvedValue(null);});
async function setup(count=5,modify?:(data:ReviewBootstrap)=>void){
 const data=structuredClone(await demoApi.getReviewBootstrap());
 while(data.questions.length<count){const q={...data.questions[0],id:crypto.randomUUID(),position:data.questions.length+1};data.questions.push(q);}
 data.questions=data.questions.slice(0,count);data.session!.maxQuestions=count;modify?.(data);
 const api:ApiClient={...demoApi,checkpointAnswers:vi.fn(async request=>({ok:true,sessionId:request.sessionId,revision:request.sessionRevision+1,checkpointed:request.answers.length,frozenHash:request.frozenHash})),submitSession:vi.fn(async()=>({ok:true,submissionId:"submission",status:"submitted",answerHash:"hash",gradeRequestCount:count}))};
 const submitted=vi.fn();const view=render(<ReviewView api={api} bootstrap={data} onClose={()=>undefined} onSubmitted={submitted}/>);
 const rerender=(next:ReviewBootstrap)=>view.rerender(<ReviewView api={api} bootstrap={next} onClose={()=>undefined} onSubmitted={submitted}/>);
 await screen.findByRole("button",{name:"查看学习资料库"});return{api,data,user:userEvent.setup(),submitted,rerender};
}
async function answer(user:ReturnType<typeof userEvent.setup>,text="make steady progress"){
 await user.type(screen.getByLabelText("你的答案"),text);await user.click(screen.getByRole("button",{name:"查看答案"}));await screen.findByTestId("answer-reveal");
}
describe("ReviewView",()=>{
 it("keeps an unsynced answer and submits the new revision after reducing today's count",async()=>{
  const{api,data,user,rerender}=await setup(2);
  await answer(user,"keep this answer");await user.click(screen.getByRole("button",{name:"下一题"}));
  const updated=structuredClone(data);updated.questions=updated.questions.slice(0,1);updated.session!.maxQuestions=1;updated.session!.revision+=1;
  rerender(updated);
  expect(screen.getByText("第 1 / 1 题")).toBeTruthy();expect((screen.getByLabelText("你的答案") as HTMLTextAreaElement).value).toBe("keep this answer");
  await user.click(screen.getByRole("button",{name:"提交本次学习"}));await waitFor(()=>expect(api.submitSession).toHaveBeenCalled());
  expect(vi.mocked(api.submitSession).mock.calls[0][0]).toMatchObject({sessionRevision:updated.session!.revision,answers:[{position:1,answer:"keep this answer"}]});
 });
 it("preserves text being typed while an increased count refreshes the same session",async()=>{
  const{api,data,user,rerender}=await setup(1);await user.type(screen.getByLabelText("你的答案"),"still typing");
  const updated=structuredClone(data);updated.questions.push({...updated.questions[0],id:"added-question",position:2});updated.session!.maxQuestions=2;updated.session!.revision+=1;
  rerender(updated);expect((screen.getByLabelText("你的答案") as HTMLTextAreaElement).value).toBe("still typing");
  await user.click(screen.getByRole("button",{name:"查看答案"}));await screen.findByTestId("answer-reveal");await user.click(screen.getByRole("button",{name:"下一题"}));await answer(user,"second answer");
  await user.click(screen.getByRole("button",{name:"提交本次学习"}));await waitFor(()=>expect(api.submitSession).toHaveBeenCalled());
  expect(vi.mocked(api.submitSession).mock.calls[0][0]).toMatchObject({sessionRevision:updated.session!.revision,answers:[{answer:"still typing"},{answer:"second answer"}]});
 });
 it("rebases cloud checkpoints without resending acknowledged answers",async()=>{
  const{api,data,user,rerender}=await setup(2);await answer(user,"cloud acknowledged");await user.click(screen.getByRole("button",{name:"下一题"}));await answer(user,"local tail");
  const updated=structuredClone(data);updated.session!.revision+=1;updated.questions[0].draft={answer:"cloud acknowledged",revision:1,answerHash:"hash",status:"checkpointed"};rerender(updated);
  await user.click(screen.getByRole("button",{name:"提交本次学习"}));await waitFor(()=>expect(api.submitSession).toHaveBeenCalled());
  expect(vi.mocked(api.submitSession).mock.calls[0][0]).toMatchObject({sessionRevision:updated.session!.revision,answers:[{position:2,answer:"local tail"}]});
 });
 it("does not roll a completed checkpoint back when an older refresh arrives during sync",async()=>{
  const{api,data,user,rerender}=await setup(5);let resolve!:()=>void;
  vi.mocked(api.checkpointAnswers).mockImplementation(request=>new Promise(done=>{resolve=()=>done({ok:true,sessionId:request.sessionId,revision:request.sessionRevision+1,checkpointed:5,frozenHash:request.frozenHash});}));
  for(let index=0;index<5;index++){await answer(user,`answer ${index+1}`);if(index<4)await user.click(screen.getByRole("button",{name:"下一题"}));}
  await waitFor(()=>expect(api.checkpointAnswers).toHaveBeenCalled());rerender(structuredClone(data));await act(async()=>resolve());
  await user.click(screen.getByRole("button",{name:"提交本次学习"}));await waitFor(()=>expect(api.submitSession).toHaveBeenCalled());
  expect(vi.mocked(api.submitSession).mock.calls[0][0]).toMatchObject({sessionRevision:data.session!.revision+1,answers:[]});
 });
 it("shows a conflict instead of discarding a different local answer on refresh",async()=>{
  const{api,data,user,rerender}=await setup(1);await answer(user,"local answer");
  const updated=structuredClone(data);updated.session!.revision+=1;updated.questions[0].draft={answer:"other device",revision:1,answerHash:"hash",status:"checkpointed"};rerender(updated);
  expect(screen.getByLabelText("第 1 题本机答案")).toBeTruthy();expect(screen.queryByRole("button",{name:"提交本次学习"})).toBeNull();
  rerender(structuredClone(updated));expect((screen.getByLabelText("第 1 题本机答案") as HTMLTextAreaElement).value).toBe("local answer");
  await user.click(screen.getByRole("button",{name:"使用云端记录继续"}));await user.click(screen.getByRole("button",{name:"提交本次学习"}));await waitFor(()=>expect(api.submitSession).toHaveBeenCalled());
  expect(vi.mocked(api.submitSession).mock.calls[0][0]).toMatchObject({sessionRevision:updated.session!.revision,answers:[]});
 });
 it("reveals the preloaded reference without a checkpoint and hides answer-leaking boundaries",async()=>{
  const{api,user}=await setup();expect(screen.queryByText("目标搭配：make steady progress")).toBeNull();await answer(user);expect(screen.getByTestId("answer-reveal").textContent).toContain("make steady progress");expect(api.checkpointAnswers).not.toHaveBeenCalled();expect((screen.getByLabelText("你的答案") as HTMLTextAreaElement).disabled).toBe(true);
 });
 it("checkpoints five answers and submits only the final tail without repeating the five",async()=>{
  const{api,user,submitted}=await setup(6);
  for(let index=0;index<6;index++){await answer(user,`answer ${index+1}`);if(index<5){await waitFor(()=>expect((screen.getByRole("button",{name:"下一题"}) as HTMLButtonElement).disabled).toBe(false));await user.click(screen.getByRole("button",{name:"下一题"}));}}
  expect(api.checkpointAnswers).toHaveBeenCalledTimes(1);expect(vi.mocked(api.checkpointAnswers).mock.calls[0][0].answers).toHaveLength(5);
  await user.click(screen.getByRole("button",{name:"提交本次学习"}));await waitFor(()=>expect(submitted).toHaveBeenCalledWith("submission"));expect(vi.mocked(api.submitSession).mock.calls[0][0].answers.map(answer=>answer.position)).toEqual([6]);
 });
 it("shows a new-expression learning card before retrieval and persists hint evidence",async()=>{
  const{api,user}=await setup(1,data=>{data.questions[0]={...data.questions[0],isNew:true,learningCard:{meaningZh:"取得稳定进展",example:"We make steady progress."},hints:["以 make 开头"]};});
  expect(screen.queryByLabelText("你的答案")).toBeNull();await user.click(screen.getByRole("button",{name:"我已看过，隐藏学习卡"}));expect(screen.queryByText("We make steady progress.")).toBeNull();await user.click(screen.getByRole("button",{name:"需要提示"}));await answer(user);await user.click(screen.getByRole("button",{name:"提交本次学习"}));await waitFor(()=>expect(api.submitSession).toHaveBeenCalled());const row=vi.mocked(api.submitSession).mock.calls[0][0].answers[0];expect(row).toMatchObject({hintUsed:true,hintCount:1,learningCardViewed:true});expect(recordActivity).toHaveBeenCalledWith(api,expect.any(String),1,"study");
 });
 it("does not silently overwrite a different local answer with cloud state",async()=>{
  const local:CheckpointAnswer={position:1,answer:"local choice",revision:1,revealHash:"x",clientInstanceId:"local",pageStartedAt:"2026-09-08"};vi.mocked(loadRecovery).mockResolvedValue({sessionId:"session",sessionRevision:1,answers:[local],checkpointedPositions:[],updatedAt:new Date().toISOString()});
  const{api,user}=await setup(1,data=>{data.questions[0].draft={answer:"cloud choice",revision:1,answerHash:"y",status:"locked"};});
  expect(screen.getByText("发现两个设备的答案不同")).toBeTruthy();expect(screen.getByLabelText("第 1 题本机答案")).toBeTruthy();expect(api.submitSession).not.toHaveBeenCalled();await user.click(screen.getByRole("button",{name:"使用云端记录继续"}));await waitFor(()=>expect((screen.getByLabelText("你的答案") as HTMLTextAreaElement).value).toBe("cloud choice"));
 });
});
