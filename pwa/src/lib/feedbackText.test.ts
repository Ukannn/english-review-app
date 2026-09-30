import { expect, it } from "vitest";
import type { GradeStatus } from "./contracts";
import { spellingPresentation } from "./feedbackText";

const grade = (feedbackZh: string): GradeStatus => ({ position: 1, result: "difficult", targetOutcome: "partial", feedbackZh, errorCategory: "spelling", confidence: .9, evidence: null, observedAnswer: "", expectedAnswer: "provide further feedback", status: "committed", needsConfirmation: false, extraPractice: [] });

it("marks explicit spelling corrections independently of the question's target", () => {
  const result = spellingPresentation("provide an updade", grade("updade 应为 update。目标词块是否符合原题，另看完整反馈。"));
  expect(result?.original).toEqual([{ text: "provide an ", changed: false }, { text: "updade", changed: true }]);
  expect(result?.suggestion).toEqual([{ text: "provide an ", changed: false }, { text: "update", changed: true }]);
});
it("supports different words and several corrections without marking unchanged correct words", () => {
  const result = spellingPresentation("Please update the adress; we will recieve an update.", grade("adress → address；recieve 应改为 receive。"));
  expect(result?.original.filter(p => p.changed).map(p => p.text)).toEqual(["adress", "recieve"]);
  expect(result?.suggestion.filter(p => p.changed).map(p => p.text)).toEqual(["address", "receive"]);
  expect(result?.suggestion.map(p => p.text).join("")).toBe("Please update the address; we will receive an update.");
});
it("keeps reasonable alternate answers unmarked even if legacy metadata contradicts them", () => {
  expect(spellingPresentation("YoY", { ...grade("YoY → year over year"), targetOutcome: "not_measured", meaningOk: true })).toBeNull();
});
it("does not invent a correction from a reference answer or a partial word match", () => {
  expect(spellingPresentation("Please check the updade.", grade("拼写需要修正，参考目标形式。"))).toBeNull();
  expect(spellingPresentation("updadeable", grade("updade → update"))).toBeNull();
  expect(spellingPresentation("provide an updade", { ...grade("updade → update"), errorCategory: "target_mismatch" })).toBeNull();
});
it("leaves a conflicting correction unmarked", () => {
  expect(spellingPresentation("teh", grade("teh → the；teh → ten"))).toBeNull();
});
it("marks the changed word inside an explicit phrase correction", () => {
  const result = spellingPresentation("provide an updade", grade("“provide an updade” → “provide an update”。"));
  expect(result?.original.filter(p => p.changed).map(p => p.text)).toEqual(["updade"]);
  expect(result?.suggestion.filter(p => p.changed).map(p => p.text)).toEqual(["update"]);
});
it("does not misread the first word of a whole phrase as a single-word correction", () => {
  expect(spellingPresentation("updade", grade("updade → provide an update"))).toBeNull();
});
