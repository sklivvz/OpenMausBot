import { expect, it } from "vitest";
import { routePortfolioTasks, type OwnershipTask } from "./objective-ownership.ts";
const owners = [{ id: "sales", names: ["Blake", "Tommy Callahan"], projectIds: ["sales-project"] }, { id: "legal", names: ["Luis Litt", "Rachel Zane"], projectIds: ["legal-project"] }, { id: "finance", names: ["Louis Tully"], projectIds: ["accounting-project"] }];
it("follows explicit ownership across project boundaries and retains cross-team dependencies", () => {
  const tasks: OwnershipTask[] = [
    { id: "raise", projectId: "legal-project", description: "Owner: Blake.\nNext actor: Blake" },
    { id: "agreements", parentId: "raise", projectId: "legal-project", description: "Owner: Luis Litt.\nPrepare legal contribution" },
    { id: "meeting", projectId: "accounting-project", description: "Owner: Blake.\nCURRENT OWNER BLOCK replaces history\nOwner: Louis Tully" },
    { id: "research", parentId: "meeting", projectId: "accounting-project", description: "" },
  ];
  expect(routePortfolioTasks(tasks, owners, "sales").map(t => t.id)).toEqual(["raise", "agreements", "meeting", "research"]);
  expect(routePortfolioTasks(tasks, owners, "legal").map(t => t.id)).toEqual(["agreements"]);
  expect(routePortfolioTasks(tasks, owners, "finance")).toEqual([]);
});
it("retains unresolved source work for reconciliation and refuses name substrings", () => {
  expect(routePortfolioTasks([{ id: "unknown", projectId: "legal-project", description: "Owner: Luis Littman" }], owners, "legal")[0].accountablePortfolio).toBe("unresolved");
  expect(routePortfolioTasks([{ id: "explicit", projectId: "legal-project", description: "Accountable owner: Blake. Tommy contributes." }], owners, "sales")[0].id).toBe("explicit");
});
it("does not inherit bot authority over an explicitly human-owned contribution", () => {
  const tasks = [{ id: "parent", projectId: "legal-project", description: "Owner: Luis Litt" }, { id: "decision", projectId: "legal-project", parentId: "parent", description: "Owner: Marco" }];
  expect(routePortfolioTasks(tasks, owners, "legal").find(t => t.id === "decision")?.accountablePortfolio).toBe("unresolved");
});

it("routes an accountable lead across projects and preserves human ownership", () => {
  const tasks = [{ id: "fundraising", projectId: "legal-project", description: "Accountable lead: Blake.\nLead proposal, not approval." }, { id: "decision", projectId: "legal-project", parentId: "fundraising", description: "Accountable lead: Marco" }];
  expect(routePortfolioTasks(tasks, owners, "sales")).toMatchObject([{ id: "fundraising", accountablePortfolio: "sales" }, { id: "decision", accountablePortfolio: "unresolved" }]);
});
