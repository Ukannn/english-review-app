import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CopyButton } from "./CopyButton";

afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("confirms only after clipboard acknowledgement, then allows another copy", async () => {
  vi.useFakeTimers();
  let resolve!: () => void;
  const writeText = vi.fn(() => new Promise<void>(done => { resolve = done; }));
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  const onCopied = vi.fn(), onError = vi.fn();
  render(<CopyButton text="learning command" label="复制指令" onCopied={onCopied} onError={onError}/>);
  fireEvent.click(screen.getByRole("button", { name: "复制指令" }));
  const pending = screen.getByRole("button", { name: "正在复制…" }) as HTMLButtonElement;
  expect(pending.disabled).toBe(true);
  expect(onCopied).not.toHaveBeenCalled();
  await act(async () => resolve());
  expect(screen.getByRole("button", { name: "已复制" }).getAttribute("aria-busy")).toBe("false");
  expect(writeText).toHaveBeenCalledWith("learning command");
  expect(onCopied).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(2400));
  expect(screen.getByRole("button", { name: "复制指令" })).toBeTruthy();
});

it("returns to the copy action after failure without claiming success", async () => {
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
  const onCopied = vi.fn(), onError = vi.fn();
  render(<CopyButton text="learning command" label="复制指令" onCopied={onCopied} onError={onError}/>);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "复制指令" })));
  expect(screen.getByRole("button", { name: "复制指令" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "已复制" })).toBeNull();
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onCopied).not.toHaveBeenCalled();
});

it("does not deliver a late clipboard result after leaving the view", async () => {
  let resolve!: () => void;
  vi.stubGlobal("navigator", { clipboard: { writeText: () => new Promise<void>(done => { resolve = done; }) } });
  const onCopied = vi.fn();
  const view = render(<CopyButton text="learning command" label="复制指令" onCopied={onCopied} onError={vi.fn()}/>);
  fireEvent.click(screen.getByRole("button", { name: "复制指令" }));
  view.unmount();
  await act(async () => resolve());
  expect(onCopied).not.toHaveBeenCalled();
});
