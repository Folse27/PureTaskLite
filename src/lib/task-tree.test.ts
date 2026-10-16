import { describe, expect, it } from "vitest";
import {
  applyMove,
  applyOrder,
  canMoveTo,
  childrenOf,
  countTopLevel,
  priorityOrder,
  resortByPriority,
  subtreeHeight,
  subtreeIds,
} from "./task-tree";
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

const make = (id: string, parentId: string | null, sortOrder: number, extra: Partial<Task> = {}): Task => ({
  ...task(id, parentId, sortOrder),
  depth: 0,
  ...extra,
});

describe("priorityOrder / resortByPriority", () => {
  const P = ["urgent", "high", "normal", "low"];
  const list = [
    make("a", null, 0, { priorityId: "low" }),
    make("b", null, 1),
    make("c", null, 2, { priorityId: "urgent" }),
    make("d", null, 3, { priorityId: "low" }),
    make("e", null, 4, { priorityId: "high" }),
  ];

  it("sorts urgent first and no priority last, keeping order among equals", () => {
    expect(priorityOrder(list, P)).toEqual(["c", "e", "a", "d", "b"]);
  });

  it("treats a deleted/unknown priority like none", () => {
    expect(priorityOrder([make("x", null, 0, { priorityId: "gone" }), make("y", null, 1, { priorityId: "low" })], P)).toEqual([
      "y",
      "x",
    ]);
  });

  it("only re-sorts the changed task's own sibling group", () => {
    const tree = [...list, make("c1", "c", 0, { depth: 1 }), make("c2", "c", 1, { depth: 1, priorityId: "urgent" })];
    const sorted = resortByPriority(tree, "e", P);
    expect(childrenOf(sorted, null).map((t) => t.id)).toEqual(["c", "e", "a", "d", "b"]);
    expect(childrenOf(sorted, "c").map((t) => t.id)).toEqual(["c1", "c2"]); // untouched
  });
});

describe("moving tasks", () => {
  // Mon: A ─ A1 ─ A1x ; B      Tue: C
  const tree = (): Task[] => [
    make("A", null, 0, { date: "2026-10-12" }),
    make("A1", "A", 0, { date: "2026-10-12", depth: 1 }),
    make("A1x", "A1", 0, { date: "2026-10-12", depth: 2 }),
    make("B", null, 1, { date: "2026-10-12" }),
    make("C", null, 0, { date: "2026-10-13" }),
  ];

  it("measures subtree height", () => {
    expect(subtreeHeight(tree(), "A")).toBe(2);
    expect(subtreeHeight(tree(), "B")).toBe(0);
  });

  it("refuses moves into the task's own subtree or beyond the depth limit", () => {
    expect(canMoveTo(tree(), "A", "A1x", 3)).toBe(false);
    expect(canMoveTo(tree(), "A", "B", 3)).toBe(true); // A(0)→1, A1x→3
    expect(canMoveTo(tree(), "A", "C", 3)).toBe(true);
    const deep = [...tree(), make("C1", "C", 0, { date: "2026-10-13", depth: 1 })];
    expect(canMoveTo(deep, "A", "C1", 3)).toBe(false); // would reach depth 4
    expect(canMoveTo(tree(), "A", null, 3)).toBe(true);
  });

  it("reorders within the same group", () => {
    const after = applyMove(tree(), "B", { parentId: null, date: "2026-10-12", index: 0 });
    expect(childrenOf(after, null).filter((t) => t.date === "2026-10-12").map((t) => t.id)).toEqual(["B", "A"]);
  });

  it("moves a subtree under another parent on another day, rebasing depth and date", () => {
    const after = applyMove(tree(), "A1", { parentId: "C", date: "ignored", index: 5 });
    const byId = new Map(after.map((t) => [t.id, t]));
    expect(byId.get("A1")).toMatchObject({ parentId: "C", date: "2026-10-13", depth: 1 });
    expect(byId.get("A1x")).toMatchObject({ parentId: "A1", date: "2026-10-13", depth: 2 });
    expect(childrenOf(after, "A")).toEqual([]);
  });

  it("turns a sub-note into a top-level task on another day at the given position", () => {
    const after = applyMove(tree(), "A1x", { parentId: null, date: "2026-10-13", index: 0 });
    const tue = after.filter((t) => t.date === "2026-10-13" && t.parentId === null);
    expect(childrenOf(tue, null).map((t) => t.id)).toEqual(["A1x", "C"]);
    expect(after.find((t) => t.id === "A1x")).toMatchObject({ depth: 0, parentId: null });
  });
});
