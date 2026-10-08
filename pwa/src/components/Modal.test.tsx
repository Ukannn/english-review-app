import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Modal } from "./Modal";

const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");

function Harness({ onClosed }: { onClosed(): void }) {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>查看反馈</button>{open && <Modal title="反馈" onClose={() => { setOpen(false); onClosed(); }}><p>当前题目的反馈</p></Modal>}</>;
}

beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value: function(this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value: function(this: HTMLDialogElement) { this.open = false; } },
  });
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false })));
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, "showModal", originalShow);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, "close", originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

it("keeps focus trapped and scroll locked through exit, then closes only once and restores the trigger", async () => {
  const closed = vi.fn();
  render(<Harness onClosed={closed}/>);
  const trigger = screen.getByRole("button", { name: "查看反馈" });
  trigger.focus(); fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog") as HTMLDialogElement;
  let finish!: () => void;
  const finished = new Promise<void>(resolve => { finish = resolve; });
  Object.defineProperty(dialog, "getAnimations", { value: () => [{ finished }] });
  const cancel = new Event("cancel", { cancelable: true });
  fireEvent(dialog, cancel);
  fireEvent.click(screen.getByRole("button", { name: "关闭反馈" }));
  expect(cancel.defaultPrevented).toBe(true);
  expect(dialog.open).toBe(true);
  expect(document.body.style.overflow).toBe("hidden");
  expect(closed).not.toHaveBeenCalled();
  await act(async () => { finish(); await finished; });
  expect(closed).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.body.style.overflow).toBe("");
  expect(document.activeElement).toBe(trigger);
});

it("closes immediately with reduced motion, and does not wait on content animations", () => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
  const closed = vi.fn();
  render(<Harness onClosed={closed}/>);
  fireEvent.click(screen.getByRole("button", { name: "查看反馈" }));
  const animations = vi.fn(() => [{ finished: new Promise(() => {}) }]);
  Object.defineProperty(screen.getByRole("dialog"), "getAnimations", { value: animations });
  fireEvent.click(screen.getByRole("button", { name: "关闭反馈" }));
  expect(closed).toHaveBeenCalledOnce();
  expect(animations).not.toHaveBeenCalled();
  expect(document.body.style.overflow).toBe("");
});

it("releases a closing dialog even if the browser never completes its animation", () => {
  vi.useFakeTimers();
  const closed = vi.fn();
  render(<Harness onClosed={closed}/>);
  fireEvent.click(screen.getByRole("button", { name: "查看反馈" }));
  Object.defineProperty(screen.getByRole("dialog"), "getAnimations", { value: () => [{ finished: new Promise(() => {}) }] });
  fireEvent.click(screen.getByRole("button", { name: "关闭反馈" }));
  act(() => { vi.advanceTimersByTime(250); });
  expect(closed).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.body.style.overflow).toBe("");
});
