import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient, ContextInbox } from "../lib/contracts";
import { ContextView } from "./LibraryViews";

afterEach(cleanup);

function setup() {
  let contexts:ContextInbox["contexts"]=[];
  const api={
    getContextInbox:vi.fn(async()=>({ok:true,contexts})),
    saveContext:vi.fn(async(payload:Record<string,unknown>)=>{
      contexts=[{id:"saved",rawText:String(payload.rawText),selectedSpans:payload.selectedSpans as unknown[],sourceUrl:null,sourceTitle:null,userNote:null,status:"pending",createdAt:"2026-09-29T00:00:00Z",candidates:[]}];
      return {ok:true,contextId:"saved"};
    }),
    listAiJobs:vi.fn(async()=>({items:[]})),
  } as unknown as ApiClient;
  render(<ContextView client={api}/>);
  return api;
}

function select(start:number,end:number) {
  const field=screen.getByLabelText("原文") as HTMLTextAreaElement;
  field.focus();
  field.setSelectionRange(start,end);
  fireEvent.click(screen.getByRole("button",{name:"标记选中的不懂部分"}));
}

describe("context selection",()=>{
  it("replays an unchanged save after a lost response without creating a second context",async()=>{
    const api=setup(),saved=new Map<string,string>();let fail=true;
    api.saveContext=vi.fn(async(_payload,_revision,key)=>{
      if(!saved.has(key))saved.set(key,`context-${saved.size+1}`);
      if(fail){fail=false;throw new Error("response timeout");}
      return {ok:true,contextId:saved.get(key)};
    });
    fireEvent.change(screen.getByLabelText("原文"),{target:{value:"Please follow up."}});
    fireEvent.click(screen.getByRole("button",{name:"保存语料"}));await screen.findByText("response timeout");
    fireEvent.click(screen.getByRole("button",{name:"保存语料"}));
    await waitFor(()=>expect(api.saveContext).toHaveBeenCalledTimes(2));
    expect(saved.size).toBe(1);expect(vi.mocked(api.saveContext).mock.calls[1][2]).toBe(vi.mocked(api.saveContext).mock.calls[0][2]);
    await waitFor(()=>expect((screen.getByLabelText("原文") as HTMLTextAreaElement).value).toBe(""));
    fireEvent.change(screen.getByLabelText("原文"),{target:{value:"Please follow up."}});
    fireEvent.click(screen.getByRole("button",{name:"保存语料"}));
    await waitFor(()=>expect(api.saveContext).toHaveBeenCalledTimes(3));expect(saved.size).toBe(2);
  });
  it("uses a new request key when a failed payload is edited",async()=>{
    const api=setup();vi.mocked(api.saveContext).mockRejectedValueOnce(new Error("offline"));
    fireEvent.change(screen.getByLabelText("原文"),{target:{value:"First source"}});
    fireEvent.click(screen.getByRole("button",{name:"保存语料"}));await screen.findByText("offline");
    fireEvent.change(screen.getByLabelText("原文"),{target:{value:"Changed source"}});
    fireEvent.click(screen.getByRole("button",{name:"保存语料"}));
    await waitFor(()=>expect(api.saveContext).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.saveContext).mock.calls[1][2]).not.toBe(vi.mocked(api.saveContext).mock.calls[0][2]);
  });
  it("saves multiple exact UTF-16 spans and shows them after readback",async()=>{
    const api=setup();
    const raw="  😀 I can't make sense of this.\nPlease follow up.";
    fireEvent.change(screen.getByLabelText("原文"),{target:{value:raw}});
    select(raw.indexOf("make sense"),raw.indexOf("make sense")+"make sense".length);
    select(raw.indexOf("follow up"),raw.indexOf("follow up")+"follow up".length);
    expect(screen.getByText("已标记 2 处")).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"保存语料"}));
    await waitFor(()=>expect(api.saveContext).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.saveContext).mock.calls[0][0]).toMatchObject({rawText:raw,selectedSpans:[
      {text:"make sense",start:raw.indexOf("make sense"),end:raw.indexOf("make sense")+10},
      {text:"follow up",start:raw.indexOf("follow up"),end:raw.indexOf("follow up")+9},
    ]});
    await waitFor(()=>expect(screen.getByText("make sense",{selector:"mark"})).toBeTruthy());
    expect(screen.getByText("follow up",{selector:"mark"})).toBeTruthy();
  });

  it("removes a mark and clears offsets when the original text changes",()=>{
    setup();
    const field=screen.getByLabelText("原文");
    fireEvent.change(field,{target:{value:"I need to figure it out."}});
    select(10,16);
    expect(screen.getByText("已标记 1 处")).toBeTruthy();
    select(12,18);
    expect(screen.getByText(/重叠/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"移除标记 figure"}));
    expect(screen.queryByText("已标记 1 处")).toBeNull();
    select(10,16);
    fireEvent.change(field,{target:{value:"Changed: I need to figure it out."}});
    expect(screen.queryByText("已标记 1 处")).toBeNull();
    expect(screen.getByText(/旧标记已清除/)).toBeTruthy();
  });
});
