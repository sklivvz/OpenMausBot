import { expect, it } from "vitest";
import { portfolioContinuation, validatePortfolio, type PortfolioObjective } from "./objective-portfolio.ts";
const objective = (id: string, state: PortfolioObjective["state"] = "ready"): PortfolioObjective => ({ id, title: `${id} business outcome`, sourceRefs: ["user-conversation"], taskIds: [id], priority: 3, state, next: "Continue authorized work", evidence: ["source-receipt"], ...(state === "waiting" ? { dependencies: [{ outcome: id, owner: "External reviewer", condition: "Review returned" }], wakeAt: 2000 } : {}) });
it("continues other marketing outcomes while the launch is blocked", () => {
  const objectives = validatePortfolio([objective("launch", "waiting"), objective("collateral"), objective("website")], ["launch", "collateral", "website"], [], 1000);
  expect(portfolioContinuation(objectives, 1000)).toEqual({ state: "ready" });
});
it("does not lose previously accepted objectives or unmapped incoming tasks", () => {
  expect(() => validatePortfolio([objective("launch")], ["launch", "collateral"], [], 1000)).toThrow(/Unaccounted/);
  expect(() => validatePortfolio([objective("launch")], ["launch"], [objective("website")], 1000)).toThrow(/disappeared/);
});
it("keeps legal, sales, finance, personal and PMO ownership independent", () => {
  const portfolios = ["legal", "sales", "finance", "personal", "pmo"].map(team => [objective(team)]);
  portfolios[0][0] = objective("legal", "waiting");
  expect(portfolios.map(p => portfolioContinuation(p, 1000).state)).toEqual(["waiting", "ready", "ready", "ready", "ready"]);
});
it("uses the earliest actual dependency and preserves stopped work", () => {
  expect(portfolioContinuation([objective("launch", "waiting"), objective("collateral", "stopped")], 1000)).toEqual({ state: "waiting", wakeAt: 2000 });
  expect(portfolioContinuation([objective("launch", "waiting")], 2000)).toEqual({ state: "ready" });
});
it("keeps future scheduled work out of immediate execution and wakes when due", () => {
  const future = validatePortfolio([{ ...objective("review"), wakeAt: 4000 }], ["review"], [], 1000);
  expect(future[0].state).toBe("scheduled");
  expect(portfolioContinuation(future, 1000)).toEqual({ state: "waiting", wakeAt: 4000 });
  expect(portfolioContinuation(future, 4000)).toEqual({ state: "ready" });
  expect(portfolioContinuation([...future, objective("execute")], 1000)).toEqual({ state: "ready" });
  expect(() => validatePortfolio([{ ...objective("review"), state: "scheduled" }], ["review"], [], 1000)).toThrow(/recorded wakeAt/);
  expect(portfolioContinuation(validatePortfolio([{ ...objective("review", "waiting"), wakeAt: 500 }], ["review"], [], 1000), 1000)).toEqual({ state: "ready" });
});
