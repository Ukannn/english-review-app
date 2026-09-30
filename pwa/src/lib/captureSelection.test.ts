import { afterEach, expect, it } from "vitest";
import { captureSelection, mergeCaptureSpans } from "./captureSelection";

afterEach(() => {document.body.innerHTML = ""; window.getSelection()?.removeAllRanges();});
function select(node: Node, start: number, end: number) {
  const range = document.createRange(); range.setStart(node, start); range.setEnd(node, end);
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  return selection;
}
it("keeps the precise repeated occurrence and its surrounding paragraph", () => {
  document.body.innerHTML = '<main><p>Try again, then try again tomorrow.</p></main>';
  const root = document.querySelector("main")!, p = root.querySelector("p")!;
  const result = captureSelection(select(p.firstChild!, 16, 25), root, "今日学习");
  expect(result?.span).toEqual({text: "try again", start: 16, end: 25});
  expect(result?.rawText).toBe(p.textContent);
});
it("calculates offsets across inline markup and trims selected whitespace", () => {
  document.body.innerHTML = '<main><p>I <em>make steady</em> progress today.</p></main>';
  const root = document.querySelector("main")!, p = root.querySelector("p")!;
  const range = document.createRange(); range.setStart(p.querySelector("em")!.firstChild!, 0);
  range.setEnd(p.lastChild!, 10);
  const selection = window.getSelection()!; selection.addRange(range);
  expect(captureSelection(selection, root, "今日学习")?.span).toEqual({text: "make steady progress", start: 2, end: 22});
});
it("excludes answer inputs, hidden answers, navigation and toolbar text", () => {
  document.body.innerHTML = '<nav><p>Menu text</p></nav><main><textarea>my answer</textarea><p hidden>hidden answer</p><aside data-capture-ui><p>toolbar English</p></aside><article><p>visible text</p><p hidden>secret answer</p></article></main>';
  const root = document.querySelector("main")!;
  for (const node of document.querySelectorAll("nav p, textarea, p[hidden], aside p")) {
    expect(captureSelection(select(node.firstChild!, 0, 4), root, "今日学习")).toBeNull();
  }
  const range = document.createRange(); range.selectNodeContents(root.querySelector("article")!);
  const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  expect(captureSelection(selection, root, "今日学习")).toBeNull();
});
it("merges overlapping marks without merging distinct occurrences", () => {
  expect(mergeCaptureSpans([{text: "steady", start: 5, end: 11}], {text: "make steady", start: 0, end: 11}, "make steady progress"))
    .toEqual([{text: "make steady", start: 0, end: 11}]);
  expect(mergeCaptureSpans([{text: "try", start: 0, end: 3}], {text: "try", start: 8, end: 11}, "try and try"))
    .toHaveLength(2);
});
it("captures selections around an entire example wrapper in a detail dialog", () => {
  document.body.innerHTML = '<main><dialog open><div><span lang="en">I want to make steady progress.</span></div></dialog></main>';
  const root = document.querySelector("main")!, example = root.querySelector("div")!;
  const range = document.createRange(); range.selectNodeContents(example);
  const selection = window.getSelection()!; selection.addRange(range);
  expect(captureSelection(selection, root, "学习资料库")?.rawText).toBe("I want to make steady progress.");
});
