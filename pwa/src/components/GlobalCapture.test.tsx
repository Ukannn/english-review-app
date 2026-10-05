import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { GlobalCapture } from "./GlobalCapture";
import { demoApi } from "../lib/demoApi";
import type { ApiClient, ContextInbox } from "../lib/contracts";

afterEach(() => {cleanup(); window.getSelection()?.removeAllRanges(); vi.restoreAllMocks();});
function clientWithInbox() {
  const contexts: ContextInbox["contexts"] = [];
  const client: ApiClient = {...demoApi,
    saveContext: vi.fn(async (payload, _revision, key) => {
      if (!contexts.some(item => item.id === key)) contexts.push({id: key,
        rawText: payload.rawText as string, selectedSpans: payload.selectedSpans as unknown[],
        sourceTitle: payload.sourceTitle as string, sourceUrl: payload.sourceUrl as string,
        userNote: payload.userNote as string, status: "pending", createdAt: "2026-09-30", candidates: []});
      return {ok: true, contextId: key};
    }),
    getContextInbox: vi.fn(async () => ({ok: true, contexts})),
  };
  return {client, contexts};
}
function select(text: string, start: number, end: number) {
  act(() => {
    const node = screen.getByText(text).firstChild!;
    const range = document.createRange(); range.setStart(node, start); range.setEnd(node, end);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    fireEvent(document, new Event("selectionchange"));
  });
}
function content(client: ApiClient, onSaved = vi.fn(), sourceTitle = "今日学习") {
  return <main id="learning-content"><GlobalCapture client={client} sourceTitle={sourceTitle} onSaved={onSaved}/>
    <p>Make steady progress and make steady progress.</p><p>Keep a close eye on the deadline.</p>
    <textarea aria-label="正在作答" defaultValue="My unfinished answer"/></main>;
}
it("saves a selection in one click, verifies it and preserves the answer", async () => {
  const {client, contexts} = clientWithInbox(), saved = vi.fn();
  render(content(client, saved));
  select("Keep a close eye on the deadline.", 5, 19);
  await userEvent.click(screen.getByRole("button", {name: "加入语料库"}));
  await screen.findByText(/已加入语料库/);
  expect(contexts[0].selectedSpans).toEqual([{text: "a close eye on", start: 5, end: 19}]);
  expect(contexts[0].rawText).toBe("Keep a close eye on the deadline.");
  expect(saved).toHaveBeenCalledOnce();
  expect((screen.getByRole("textbox", {name: "正在作答"}) as HTMLTextAreaElement).value).toBe("My unfinished answer");
});
it("groups multiple marks by original paragraph and keeps them across page navigation", async () => {
  const {client, contexts} = clientWithInbox();
  const view = render(content(client));
  select("Make steady progress and make steady progress.", 0, 20);
  await userEvent.click(screen.getByRole("button", {name: "标记所选"}));
  select("Make steady progress and make steady progress.", 25, 45);
  await userEvent.click(screen.getByRole("button", {name: "标记所选"}));
  view.rerender(content(client, vi.fn(), "学习资料库"));
  select("Keep a close eye on the deadline.", 0, 18);
  await userEvent.click(screen.getByRole("button", {name: "加入语料库"}));
  await screen.findByText(/已加入语料库 · 2 段原文/);
  expect(contexts).toHaveLength(2);
  expect(contexts[0].selectedSpans).toHaveLength(2);
  expect(contexts.map(item => item.sourceTitle)).toEqual(["今日学习", "学习资料库"]);
});
it("retries only failed paragraphs with their original request key", async () => {
  const {client, contexts} = clientWithInbox();
  const original = client.saveContext;
  let fail = true;
  client.saveContext = vi.fn(async (...args: Parameters<ApiClient["saveContext"]>) => {
    if (args[0].rawText === "Keep a close eye on the deadline." && fail) {fail = false; throw new Error("offline");}
    return original(...args);
  });
  render(content(client));
  select("Make steady progress and make steady progress.", 0, 20);
  await userEvent.click(screen.getByRole("button", {name: "标记所选"}));
  select("Keep a close eye on the deadline.", 0, 18);
  await userEvent.click(screen.getByRole("button", {name: "加入语料库"}));
  await screen.findByText(/还有 1 段未确认/);
  const key = vi.mocked(client.saveContext).mock.calls[1][2];
  await userEvent.click(screen.getByRole("button", {name: "重试收录"}));
  await screen.findByText(/已加入语料库/);
  expect(vi.mocked(client.saveContext).mock.calls[2][2]).toBe(key);
  expect(client.saveContext).toHaveBeenCalledTimes(3);
  expect(contexts).toHaveLength(2);
});
it("retains an unconfirmed save and retries readback without a second write", async () => {
  const {client} = clientWithInbox();
  vi.mocked(client.getContextInbox).mockRejectedValueOnce(new Error("read timeout"));
  render(content(client));
  select("Keep a close eye on the deadline.", 0, 18);
  await userEvent.click(screen.getByRole("button", {name: "加入语料库"}));
  await screen.findByText(/收录结果暂未确认/);
  await userEvent.click(screen.getByRole("button", {name: "重试收录"}));
  await screen.findByText(/已加入语料库/);
  expect(client.saveContext).toHaveBeenCalledOnce();
});
it("makes collection controls available inside a modal detail sheet", async () => {
  const {client} = clientWithInbox();
  render(<main id="learning-content"><GlobalCapture client={client} sourceTitle="学习资料库" onSaved={vi.fn()}/><dialog open aria-label="学习详情"><p>Keep a close eye on the deadline.</p></dialog></main>);
  const dialog = screen.getByRole("dialog");
  expect(await within(dialog).findByRole("complementary", {name: "随手收录"})).toBeTruthy();
  select("Keep a close eye on the deadline.", 0, 18);
  await userEvent.click(within(dialog).getByRole("button", {name: "加入语料库"}));
  await within(dialog).findByText(/已加入语料库/);
});
it("collapses marked passages and preserves them, the answer and retry key across navigation",async()=>{
  const {client,contexts}=clientWithInbox(),view=render(content(client));
  vi.mocked(client.saveContext).mockRejectedValueOnce(new Error("offline"));
  select("Keep a close eye on the deadline.",0,18);
  await userEvent.click(screen.getByRole("button",{name:"标记所选"}));
  expect(screen.getByRole("button",{name:"展开随手收录"}).getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("button",{name:"加入语料库"})).toBeNull();
  await userEvent.click(screen.getByRole("button",{name:"展开随手收录"}));
  await userEvent.click(screen.getByRole("button",{name:"加入语料库"}));await screen.findByText(/还有 1 段未确认/);
  const key=vi.mocked(client.saveContext).mock.calls[0][2];
  view.rerender(content(client,vi.fn(),"学习资料库"));
  await userEvent.click(screen.getByRole("button",{name:"展开随手收录"}));
  await userEvent.click(screen.getByRole("button",{name:"重试收录"}));await screen.findByText(/已加入语料库/);
  expect(vi.mocked(client.saveContext).mock.calls[1][2]).toBe(key);expect(contexts).toHaveLength(1);
  expect((screen.getByRole("textbox",{name:"正在作答"}) as HTMLTextAreaElement).value).toBe("My unfinished answer");
});
