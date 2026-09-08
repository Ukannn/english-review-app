import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { AiHandoff } from "./AiHandoff";
import { demoApi } from "../lib/demoApi";
import { sha256Jsonb } from "../lib/hash";
import type { ApiClient, SubmissionStatus } from "../lib/contracts";
afterEach(cleanup);
it("freezes the actual confirmation decisions and permits an independent correction",async()=>{
 const status:SubmissionStatus={ok:true,submissionId:"submission",sessionId:"session",status:"needs_confirmation",answerHash:"answer-hash-not-decision-hash",revision:3,errorCode:null,errorDetail:null,journal:null,grades:[{position:1,result:"normal",feedbackZh:"表达可以成立。",errorCategory:null,confidence:.9,evidence:"answer",expectedAnswer:"push back",observedAnswer:"postpone",status:"needs_confirmation",needsConfirmation:true,extraPractice:[],targetOutcome:"correct",meaningOk:true,naturalness:"natural",hintUsed:false}]};
 const api:ApiClient={...demoApi,getSubmissionStatus:vi.fn(async()=>status),confirmGrades:vi.fn(async()=>({ok:true}))};const user=userEvent.setup();render(<AiHandoff api={api} submissionId="submission" onDone={()=>undefined} onClose={()=>undefined}/>);await screen.findByText("第 1 题");await user.selectOptions(screen.getByLabelText("目标提取"),"not_measured");await user.click(screen.getByRole("button",{name:"确认以上批改并更新复习安排"}));await waitFor(()=>expect(api.confirmGrades).toHaveBeenCalled());const args=vi.mocked(api.confirmGrades).mock.calls[0];expect(args[1][0]).toMatchObject({decision:"accept",targetOutcome:"not_measured",meaningOk:true});expect(args[4]).toBe(await sha256Jsonb(args[1]));
});
