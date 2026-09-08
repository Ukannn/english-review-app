import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LearningApp } from "./App";
import { demoApi } from "./lib/demoApi";

afterEach(cleanup);

it("repairs the daily queue on opening before loading dashboard totals", async () => {
  const calls: string[] = [];
  const client = {
    ...demoApi,
    getReviewBootstrap: vi.fn(async () => { calls.push("queue"); return demoApi.getReviewBootstrap(); }),
    getDashboard: vi.fn(async () => { calls.push("dashboard"); return demoApi.getDashboard(); }),
  };
  render(<LearningApp client={client} demo />);
  await screen.findByRole("button", { name: "开始 / 继续学习 →" });
  expect(calls).toEqual(["queue", "dashboard"]);
});
