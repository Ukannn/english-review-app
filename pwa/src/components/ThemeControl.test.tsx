import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ThemeControl } from "./ThemeControl";

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllGlobals(); });
it("synchronizes the toolbar and settings controls in the same window", () => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  render(<><ThemeControl/><ThemeControl/></>);
  fireEvent.click(screen.getAllByRole("button", { name: "深色" })[0]);
  expect(screen.getAllByRole("button", { name: "深色" }).every(b => b.getAttribute("aria-pressed") === "true")).toBe(true);
  expect(document.documentElement.dataset.theme).toBe("dark");
  fireEvent.click(screen.getAllByRole("button", { name: "系统" })[1]);
  expect(screen.getAllByRole("button", { name: "系统" }).every(b => b.getAttribute("aria-pressed") === "true")).toBe(true);
  expect(document.documentElement.dataset.theme).toBe("light");
});
