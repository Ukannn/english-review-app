import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { GradeStatus } from "../lib/contracts";
import { FeedbackCarousel } from "./FeedbackCarousel";

const grade = (position: number): GradeStatus => ({ position, result: "difficult", targetOutcome: "partial", feedbackZh: "原始反馈", errorCategory: null, confidence: .9, evidence: "原答", observedAnswer: `answer ${position}`, expectedAnswer: `target ${position}`, status: "committed", needsConfirmation: false, extraPractice: [] });
function setup(count = 3) { vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))); return render(<FeedbackCarousel grades={Array.from({ length: count }, (_, i) => grade(i + 1))} active onOpen={vi.fn()}/>); }
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("uses distinct neighbors and never clones a third card for two items", () => {
  setup(2);
  expect(screen.queryByRole("button", { name: /选择上一条/ })).toBeNull();
  expect(screen.getAllByRole("button", { name: /选择下一条/ })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: /选择下一条/ }));
  expect(screen.getByRole("article").textContent).toContain("answer 2");
  expect(screen.getByRole("switch", { name: "自动轮播" }).getAttribute("aria-checked")).toBe("false");
});
it("shows neutral zero and static one-item states", () => {
  const view = setup(0);
  expect(screen.getByText(/没有已记录的重点项/)).toBeTruthy();
  view.rerender(<FeedbackCarousel grades={[grade(1)]} active onOpen={vi.fn()}/>);
  expect(screen.queryByRole("switch", { name: "自动轮播" })).toBeNull();
});
it("latches pause after reading and only explicit play restarts a fresh nine seconds", () => {
  vi.useFakeTimers(); setup();
  act(() => vi.advanceTimersByTime(9000));
  expect(screen.getByRole("article").textContent).toContain("answer 2");
  fireEvent.pointerEnter(document.querySelector(".carousel-stage")!);
  fireEvent.pointerLeave(document.querySelector(".carousel-stage")!);
  act(() => vi.advanceTimersByTime(18000));
  expect(screen.getByRole("article").textContent).toContain("answer 2");
  fireEvent.click(screen.getByRole("switch", { name: "自动轮播" }));
  act(() => vi.advanceTimersByTime(8999));
  expect(screen.getByRole("article").textContent).toContain("answer 2");
  act(() => vi.advanceTimersByTime(1));
  expect(screen.getByRole("article").textContent).toContain("answer 3");
});
it("stays paused after leaving the page and returning", () => {
  vi.useFakeTimers(); const view = setup();
  view.rerender(<FeedbackCarousel grades={[grade(1), grade(2), grade(3)]} active={false} onOpen={vi.fn()}/>);
  view.rerender(<FeedbackCarousel grades={[grade(1), grade(2), grade(3)]} active onOpen={vi.fn()}/>);
  act(() => vi.advanceTimersByTime(18000));
  expect(screen.getByRole("article").textContent).toContain("answer 1");
  expect(screen.getByRole("switch", { name: "自动轮播" }).getAttribute("aria-checked")).toBe("false");
});
it("keeps reasonable alternative answers separate from errors", () => {
  const view = setup(1);
  view.rerender(<FeedbackCarousel grades={[{ ...grade(1), result: "normal", targetOutcome: "not_measured", meaningOk: true }]} active onOpen={vi.fn()}/>);
  expect(screen.getByText("意思正确 · 目标形式未测到")).toBeTruthy();
});
it("moves the same neighboring card into the center instead of replacing its text", () => {
  setup(4);
  const nextCard = document.querySelector('article[data-position="2"]');
  expect(nextCard?.getAttribute("data-slot")).toBe("right");
  fireEvent.click(screen.getByRole("button", { name: /选择下一条/ }));
  expect(document.querySelector('article[data-position="2"]')).toBe(nextCard);
  expect(nextCard?.getAttribute("data-slot")).toBe("active");
  expect(document.querySelector('article[data-position="1"]')?.getAttribute("data-slot")).toBe("left");
  expect(document.querySelectorAll('article[data-parked="false"]')).toHaveLength(3);
  expect(document.querySelectorAll("article")).toHaveLength(4);
  const arriving = document.querySelector('article[data-position="3"]');
  expect(arriving?.getAttribute("data-slot")).toBe("right");
});
it("pauses when keyboard focus enters the arrow controls", () => {
  vi.useFakeTimers(); setup();
  fireEvent.focus(screen.getByRole("button", { name: "下一条反馈" }));
  act(() => vi.advanceTimersByTime(18000));
  expect(screen.getByRole("article").textContent).toContain("answer 1");
  expect(screen.getByRole("switch", { name: "自动轮播" }).getAttribute("aria-checked")).toBe("false");
});
it("uses a supplied evidence snippet only when it occurs verbatim in the original answer", () => {
  const view = setup(1);
  view.rerender(<FeedbackCarousel grades={[{ ...grade(1), observedAnswer: "The original answer contains updade here.", evidence: "updade" }]} active onOpen={vi.fn()}/>);
  expect(screen.getByText("updade")).toBeTruthy();
  view.rerender(<FeedbackCarousel grades={[{ ...grade(1), observedAnswer: "The original answer contains updade here.", evidence: "update" }]} active onOpen={vi.fn()}/>);
  expect(screen.getByText("The original answer contains updade here.")).toBeTruthy();
});
it("retains a parked card so a newly arriving neighbor can use the template transition", () => {
  setup(4);
  const arriving = document.querySelector('article[data-position="3"]');
  expect(arriving?.getAttribute("data-parked")).toBe("true");
  expect(arriving?.getAttribute("data-slot")).toBe("left");
  fireEvent.click(screen.getByRole("button", { name: /选择下一条/ }));
  expect(document.querySelector('article[data-position="3"]')).toBe(arriving);
  expect(arriving?.getAttribute("data-parked")).toBe("false");
  expect(arriving?.getAttribute("data-slot")).toBe("right");
});
it("uses the template's word markers only for evidenced spelling corrections", () => {
  const view = setup(1);
  view.rerender(<FeedbackCarousel grades={[{ ...grade(1), observedAnswer: "Please check the adress.", evidence: null, feedbackZh: "adress → address", errorCategory: "spelling", expectedAnswer: "provide further feedback" }]} active onOpen={vi.fn()}/>);
  expect(document.querySelector(".marked-word")?.textContent).toBe("adress");
  expect(document.querySelector(".answer-comparison strong")?.textContent).toBe("address");
  expect(screen.getByText("建议写法")).toBeTruthy();
  expect(document.querySelectorAll(".answer-comparison p")[1].textContent).toBe("Please check the address.");
  view.rerender(<FeedbackCarousel grades={[{ ...grade(1), targetOutcome: "not_measured", meaningOk: true, observedAnswer: "YoY", expectedAnswer: "year over year", feedbackZh: "YoY 是合理别答。" }]} active onOpen={vi.fn()}/>);
  expect(document.querySelector(".marked-word, .answer-comparison strong")).toBeNull();
});
