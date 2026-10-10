import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LessonView } from "./LessonView";
import type { ApiClient, ReviewBootstrap } from "../lib/contracts";
vi.mock("../lib/recovery",()=>({loadRecovery:vi.fn().mockResolvedValue(null),saveRecovery:vi.fn().mockResolvedValue(undefined)}));
import { loadRecovery, saveRecovery } from "../lib/recovery";
const q=(position:number,phase:"review"|"expression"="review")=>({id:`q${position}`,position,phase,answerForm:"chunk" as const,phraseId:`p${position}`,candidateId:null,questionType:"whole_recall",promptZh:`任务 ${position}`,promptEn:null,expectedAnswers:["run as scheduled"],acceptedVariants:[],semanticBoundary:"private answer leak",contentHash:"hash",draft:null,hints:["提示线索"],isNew:false});
const b=():ReviewBootstrap=>({ok:true,ruleVersion:"english_v3",state:"open",learningDate:"2026-09-28",session:{id:"s",revision:1,maxQuestions:3,status:"open"},questions:[q(1),q(2,"expression"),q(3,"expression")],lesson:{id:"l",theme:"life",sequence:1,material:null,readingStarted:false,readingCompleted:false,readingSeconds:0,burden:null}});
function setup(bootstrap=b()) {let revision=1;const api={checkpointAnswers:vi.fn(async()=>({ok:true,revision:++revision})),recordLessonActivity:vi.fn().mockResolvedValue({ok:true}),recordQuestionActivity:vi.fn().mockResolvedValue({ok:true}),getReviewBootstrap:vi.fn().mockResolvedValue({...bootstrap,lesson:{...bootstrap.lesson,readingStarted:true,material:{title:"Story",body:"Safe reading text",notes:[],explanationZh:"帮助"}}}),submitSession:vi.fn().mockResolvedValue({submissionId:"sub"})} as unknown as ApiClient;const onSubmitted=vi.fn(),onRefresh=vi.fn().mockResolvedValue(undefined);const view=render(<LessonView api={api} bootstrap={bootstrap} todayDate="2026-10-05" onRefresh={onRefresh} onSubmitted={onSubmitted}/>);return {api,onSubmitted,onRefresh,...view,refresh:(fresh:ReviewBootstrap)=>view.rerender(<LessonView api={api} bootstrap={fresh} todayDate="2026-10-05" onRefresh={onRefresh} onSubmitted={onSubmitted}/>)};}
async function clickWhenReady(name:string) {
  const button=await screen.findByRole("button",{name}) as HTMLButtonElement;
  await waitFor(()=>expect(button.disabled).toBe(false));
  fireEvent.click(button);
}
afterEach(cleanup);
beforeEach(()=>{sessionStorage.clear();vi.clearAllMocks();vi.mocked(loadRecovery).mockResolvedValue(null);});
describe("lesson phases and evidence",()=>{
 it("jumps among review questions while retaining drafts and reading gates",async()=>{
  const boot=b();boot.questions=[q(1),q(2),q(3,"expression"),q(4,"expression")];const {api}=setup(boot);await screen.findByText("任务 1");
  fireEvent.change(screen.getByRole("textbox"),{target:{value:"draft one"}});
  fireEvent.click(screen.getByRole("button",{name:"第 2 题 · 未答"}));await screen.findByText("任务 2");
  fireEvent.change(screen.getByRole("textbox"),{target:{value:"draft two"}});
  fireEvent.click(screen.getByRole("button",{name:"第 1 题 · 草稿"}));expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("draft one");
  expect((screen.getByRole("button",{name:"第 3 题 · 阅读后解锁"}) as HTMLButtonElement).disabled).toBe(true);
  expect(api.checkpointAnswers).not.toHaveBeenCalled();expect(api.recordLessonActivity).not.toHaveBeenCalled();
 });
 it("restores a selected draft and a locked reference view after remount",async()=>{
  const boot=b();boot.questions=[q(1),q(2),q(3,"expression")];setup(boot);await screen.findByText("任务 1");
  fireEvent.click(screen.getByRole("button",{name:"第 2 题 · 未答"}));cleanup();
  vi.mocked(loadRecovery).mockResolvedValue({sessionId:"s",sessionRevision:1,answers:[],checkpointedPositions:[],updatedAt:"now",lessonWork:{inputs:{2:"second draft"},seconds:{2:12}}});
  const view=setup(boot);await screen.findByDisplayValue("second draft");expect(screen.getByText("任务 2")).toBeTruthy();
  await clickWhenReady("保存并看参考");await screen.findByText("参考表达");await waitFor(()=>expect(view.api.checkpointAnswers).toHaveBeenCalled());
  const recovered=vi.mocked(saveRecovery).mock.calls.at(-1)![0];cleanup();vi.mocked(loadRecovery).mockResolvedValue(recovered);setup(boot);
  await screen.findByText("参考表达");expect((screen.getByRole("textbox") as HTMLTextAreaElement).disabled).toBe(true);
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("second draft");
  await clickWhenReady("继续");await screen.findByText("任务 1");
 });
 it("permits jumping between expressions only after reading is complete",async()=>{
  const boot=b();boot.questions[0].draft={answer:"saved",revision:1,answerHash:"hash",status:"checkpointed"};boot.lesson!.readingStarted=true;boot.lesson!.readingCompleted=true;
  setup(boot);await screen.findByText("任务 2");fireEvent.click(screen.getByRole("button",{name:"第 3 题 · 未答"}));await screen.findByText("任务 3");
  fireEvent.click(screen.getByRole("button",{name:"第 1 题 · 已作答"}));await screen.findByText("参考表达");await clickWhenReady("继续");await screen.findByText("任务 2");
 });

 it("keeps private rubric and material hidden until review is saved",async()=>{const {api}=setup();await screen.findByText("任务 1");expect(screen.queryByText("private answer leak")).toBeNull();expect(screen.queryByText("Story")).toBeNull();fireEvent.click(screen.getByText("跳过"));await screen.findByText("开始阅读");await clickWhenReady("开始阅读");await screen.findByText("Story");expect(api.checkpointAnswers).toHaveBeenCalled();expect(api.recordLessonActivity).toHaveBeenCalledWith("s","reading_start",0,null,"lesson:s:reading_start:0");});
 it("freezes dont_know separately from skipped and submits a partial lesson",async()=>{const {api}=setup();await screen.findByText("任务 1");fireEvent.click(screen.getByText("暂时不会"));await screen.findByText("参考表达");await clickWhenReady("结束本次并批改已答内容");await waitFor(()=>expect(api.submitSession).toHaveBeenCalled());const batch=vi.mocked(api.checkpointAnswers).mock.calls.flatMap(call=>call[0].answers);expect(batch.map(a=>a.attemptState)).toEqual(["dont_know","skipped","skipped"]);expect(batch.map(a=>a.answer)).toEqual(["","",""]);});
 it("persists unrevealed text and restores it",async()=>{vi.mocked(loadRecovery).mockResolvedValue({sessionId:"s",sessionRevision:1,answers:[],checkpointedPositions:[],updatedAt:"now",lessonWork:{inputs:{1:"my draft"},seconds:{1:12}}});setup();await screen.findByDisplayValue("my draft");fireEvent.change(screen.getByRole("textbox"),{target:{value:"changed draft"}});await waitFor(()=>expect(saveRecovery).toHaveBeenCalledWith(expect.objectContaining({lessonWork:expect.objectContaining({inputs:{1:"changed draft"}})})));});
 it("does not treat a hidden learning card as independent prior knowledge",async()=>{const boot=b();boot.questions[0]={...boot.questions[0],isNew:true,learningCard:{meaningZh:"按计划运行",example:"The task ran as scheduled.",usageNote:"按安排"}};setup(boot);await screen.findByText("先熟悉这个表达");expect(screen.queryByRole("textbox")).toBeNull();fireEvent.click(screen.getByText("隐藏学习卡，试着回忆"));await screen.findByRole("textbox");});
 it("preserves conflicting local and cloud answers until explicitly resolved",async()=>{const boot=b();boot.questions[0]={...boot.questions[0],draft:{answer:"cloud answer",revision:1,answerHash:"hash",status:"checkpointed",attemptState:"answered",activeSeconds:8}};vi.mocked(loadRecovery).mockResolvedValue({sessionId:"s",sessionRevision:1,answers:[{position:1,answer:"local answer",revision:1,revealHash:"hash",attemptState:"answered",activeSeconds:7,clientInstanceId:"test",pageStartedAt:"now"}],checkpointedPositions:[],updatedAt:"now"});setup(boot);await screen.findByText("请先核对不同设备的答案");expect(screen.getByText(/local answer/)).toBeTruthy();expect(screen.getByText(/cloud answer/)).toBeTruthy();expect(saveRecovery).not.toHaveBeenCalled();fireEvent.click(screen.getByText("已核对，继续云端进度"));await screen.findByText("开始阅读");});

 it("merges a same-session refresh and checkpoints remaining answers at the cloud revision",async()=>{
  const boot=b();boot.questions=[q(1),q(2),q(3,"expression"),q(4,"expression")];
  vi.mocked(loadRecovery).mockResolvedValue({sessionId:"s",sessionRevision:1,answers:[],checkpointedPositions:[],updatedAt:"now",lessonWork:{inputs:{2:"unsent local text"},seconds:{2:12}}});
  const view=setup(boot);await screen.findByText("任务 1");
  const fresh={...boot,session:{...boot.session!,revision:7},questions:boot.questions.map((question,i)=>i?question:{...question,draft:{answer:"cloud answer",revision:1,answerHash:"cloud hash",status:"checkpointed",attemptState:"answered" as const,activeSeconds:9}})};
  view.refresh(fresh);await screen.findByDisplayValue("unsent local text");
  fireEvent.click(screen.getByRole("button",{name:"保存并看参考"}));
  await waitFor(()=>expect(view.api.checkpointAnswers).toHaveBeenCalled());
  expect(vi.mocked(view.api.checkpointAnswers).mock.calls[0][0]).toMatchObject({sessionRevision:7,answers:[{position:2,answer:"unsent local text",activeSeconds:12}]});
 });
 it("shows an older unfinished lesson and keeps its reading progress on refresh",async()=>{
  const boot=b();boot.questions[0]={...boot.questions[0],draft:{answer:"saved",revision:1,answerHash:"hash",status:"checkpointed"}};
  boot.lesson={...boot.lesson!,readingStarted:true,readingSeconds:57,material:{title:"Saved reading",kind:"passage",body:"Reading body",targetPhraseIds:[],notes:[],explanationZh:"说明"}};
  const view=setup(boot);await screen.findByText("Saved reading");
  expect(screen.getByText("2026年9月28日 · 继续未完成的学习")).toBeTruthy();
  view.refresh({...boot,session:{...boot.session!,revision:9},lesson:{...boot.lesson!,readingSeconds:75,readingCompleted:true}});
  await screen.findByText("任务 2");expect(screen.getByText("阅读 已完成")).toBeTruthy();
 });
 it("does not roll back a confirmed revision when an older refresh arrives",async()=>{
  const view=setup();await screen.findByText("任务 1");await clickWhenReady("跳过");await screen.findByText("开始阅读");
  view.refresh({...b()});await clickWhenReady("结束本次并批改已答内容");
  await waitFor(()=>expect(view.api.submitSession).toHaveBeenCalled());
  expect(vi.mocked(view.api.checkpointAnswers).mock.calls[1][0].sessionRevision).toBe(2);
 });
 it("requires review when a refreshed cloud answer differs from unrevealed local input",async()=>{
  const view=setup();await screen.findByText("任务 1");fireEvent.change(screen.getByRole("textbox"),{target:{value:"my unsent answer"}});
  const fresh=b();fresh.session!.revision=2;fresh.questions[0]={...fresh.questions[0],draft:{answer:"other device answer",revision:1,answerHash:"hash",status:"checkpointed"}};
  view.refresh(fresh);await screen.findByText("请先核对不同设备的答案");
  expect(screen.getByText(/my unsent answer/)).toBeTruthy();expect(screen.getByText(/other device answer/)).toBeTruthy();
  expect(view.api.checkpointAnswers).not.toHaveBeenCalled();
 });

});
