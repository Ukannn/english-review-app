import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { demoApi } from "../lib/demoApi";
import { QuestionNavigator } from "./QuestionNavigator";

afterEach(cleanup);
it("supports a large set, announces the current question, and collapses after selection", async () => {
  const bootstrap = await demoApi.getReviewBootstrap();
  const questions = Array.from({length:150}, (_, index) => ({...bootstrap.questions[0],id:`question-${index}`,position:index+1}));
  const onSelect = vi.fn();
  render(<QuestionNavigator questions={questions} currentId="question-99" answers={new Map()} inputs={{100:"unfinished"}} disabled={false} onSelect={onSelect}/>);
  const toggle = screen.getByRole("button", {name:/答题卡/});
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  const current = screen.getByRole("button", {name:"第 100 题 · 草稿"});
  expect(current.getAttribute("aria-current")).toBe("step");
  fireEvent.click(screen.getByRole("button", {name:"第 150 题 · 未答"}));
  expect(onSelect).toHaveBeenCalledWith(questions[149]);
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
});
