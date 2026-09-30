import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { designDemoApi } from "../lib/designDemo";
import { ExpressionColumn } from "./ReportCharts";

afterEach(cleanup);
it("pins one segment, reports its true denominator and closes on outside tap or Escape", async () => {
  const items = (await designDemoApi.getPhraseLibrary(null, 150)).items;
  render(<ExpressionColumn items={items} onRecords={vi.fn()}/>);
  const button = screen.getByRole("button", { name: /巩固中 \d+ 个，占/ });
  fireEvent.click(button);
  expect(button.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("status").textContent).toContain("/ 125 个");
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("status")).toBeNull();
  fireEvent.click(button); fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("status")).toBeNull();
});
