import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { TypographyText } from "./TypographyText";

afterEach(cleanup);

it("preserves Chinese copy and keeps a complete ending with its punctuation", () => {
  const text = "少量复习，一段阅读，再把表达用起来。";
  const { container } = render(<p><TypographyText text={text}/></p>);
  expect(container.textContent).toBe(text);
  const ending = container.querySelector(".typography-keep")?.textContent ?? "";
  expect(ending.endsWith("。")).toBe(true);
  expect(Array.from(ending.match(/[\p{Script=Han}]/gu) ?? []).length).toBeGreaterThanOrEqual(2);
});

it("does not change spaces, English answers or markup-like source text", () => {
  const text = '原答：<script>"I will set aside time."</script>  ';
  const { container } = render(<p><TypographyText text={text}/></p>);
  expect(container.textContent).toBe(text);
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector(".typography-keep")).toBeNull();
});
