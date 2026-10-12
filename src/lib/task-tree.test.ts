import { describe, expect, it } from "vitest";
import { applyOrder, childrenOf, countTopLevel, subtreeIds } from "./task-tree";
import type { Task } from "./types";

const task = (id: string, parentId: string | null, sortOrder = 0): Task => ({
  id,
  parentId,
  sortOrder,
  date: "2026-10-12",
  depth: 0,
  title: id,
  description: null,
  statusId: null,
  priorityId: null,
  createdAt: "2026-10-12T00:00:00Z",
  updatedAt: "2026-10-12T00:00:00Z",
});

const tasks = [task("a", null, 1), task("b", null, 0), task("a1", "a"), task("a1x", "a1"), task("b1", "b")];

describe("task tree helpers", () => {
  it("orders siblings by sortOrder", () => {
    expect(childrenOf(tasks, null).map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("collects a subtree", () => {
    expect([...subtreeIds(tasks, "a")].sort()).toEqual(["a", "a1", "a1x"]);
    expect([...subtreeIds(tasks, "b1")]).toEqual(["b1"]);
  });

  it("counts top-level tasks", () => {
    expect(countTopLevel(tasks)).toBe(2);
  });

  it("applies a new order", () => {
    expect(childrenOf(applyOrder(tasks, ["a", "b"]), null).map((t) => t.id)).toEqual(["a", "b"]);
  });
});
