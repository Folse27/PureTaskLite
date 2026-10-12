import { describe, expect, it } from "vitest";
import type { AssistantChange, Label } from "@/lib/types";
import {
  classifyConfirmation,
  composeReply,
  handlesIn,
  isIncompleteReply,
  spokenTaskList,
  modelResponseSchema,
  planOperations,
  type KnownTask,
  type Operation,
} from "./plan";

const statuses: Label[] = [
  { id: "s-todo", name: "To do", color: "#8E8E93", sortOrder: 0 },
  { id: "s-done", name: "Done", color: "#34C759", sortOrder: 1 },
];
const priorities: Label[] = [{ id: "p-high", name: "High", color: "#FF9500", sortOrder: 0 }];

const known = new Map<string, KnownTask>([
  ["aaaaaa", { id: "id-a", title: "Portfolio", date: "2026-10-12", depth: 0, subtreeIds: ["id-a", "id-a1", "id-a2"] }],
  ["a1a1a1", { id: "id-a1", title: "Thumbnails", date: "2026-10-12", depth: 1, subtreeIds: ["id-a1"] }],
  ["deep00", { id: "id-deep", title: "Deep", date: "2026-10-12", depth: 3, subtreeIds: ["id-deep"] }],
  ["bbbbbb", { id: "id-b", title: "Gym", date: "2026-10-13", depth: 0, subtreeIds: ["id-b"] }],
]);
const ctx = { known, statuses, priorities };

/** Builds an operation the way the strict schema delivers it (all fields present, null when unused). */
const op = (fields: Partial<Record<keyof Operation, string>> & { op: Operation["op"] }): Operation =>
  modelResponseSchema.parse({ reply: "", operations: [fields], lookup: null }).operations[0];

describe("modelResponseSchema", () => {
  it("accepts the strict-mode shape and treats an all-null lookup as none", () => {
    const parsed = modelResponseSchema.parse({
      reply: "Hi",
      operations: [
        { op: "create", ref: "a", id: null, parent: null, date: "2026-10-12", title: " X ", description: null, status: null, priority: null },
      ],
      lookup: { query: null, from: null, to: null },
    });
    expect(parsed.lookup).toBeNull();
    expect(parsed.operations[0]).toMatchObject({ op: "create", ref: "a", title: "X", parent: undefined });
  });

  it("keeps a real lookup", () => {
    const parsed = modelResponseSchema.parse({ reply: "", operations: [], lookup: { query: "dentist", from: null, to: null } });
    expect(parsed.lookup).toEqual({ query: "dentist", from: undefined, to: undefined });
  });
});

describe("handlesIn", () => {
  it("collects existing handles but not refs created in the same answer", () => {
    expect(
      handlesIn([
        op({ op: "create", ref: "a", date: "2026-10-12", title: "P" }),
        op({ op: "create", parent: "a", title: "Child" }),
        op({ op: "create", parent: "AAAAAA", title: "Child of existing" }),
        op({ op: "update", id: "bbbbbb", title: "Gym!" }),
        op({ op: "delete", id: "a1a1a1" }),
      ]).sort(),
    ).toEqual(["a1a1a1", "aaaaaa", "bbbbbb"]);
  });
});

describe("planOperations", () => {
  it("plans a task with a sub-note and a task on each weekday in one go", () => {
    const ops = [
      op({ op: "create", ref: "p", date: "2026-10-12", title: "Finish portfolio website" }),
      op({ op: "create", parent: "p", title: "Create thumbnails" }),
      ...["12", "13", "14", "15", "16"].map((d) => op({ op: "create", date: `2026-10-${d}`, title: "Help friend with homework" })),
    ];
    const plan = planOperations(ops, ctx);
    expect(plan.problems).toEqual([]);
    expect(plan.creates).toHaveLength(7);
    expect(plan.creates[1]).toMatchObject({ parent: { kind: "new", key: "p" }, date: null, depth: 1 });
  });

  it("handles a sub-note listed before its parent", () => {
    const plan = planOperations(
      [op({ op: "create", parent: "p", title: "Child" }), op({ op: "create", ref: "p", date: "2026-10-12", title: "Parent" })],
      ctx,
    );
    expect(plan.problems).toEqual([]);
    expect(plan.creates.map((c) => c.title)).toEqual(["Parent", "Child"]);
  });

  it("enforces the depth limit across new and existing parents", () => {
    const plan = planOperations(
      [
        op({ op: "create", parent: "deep00", title: "Too deep" }),
        op({ op: "create", ref: "x", parent: "a1a1a1", title: "Level 2" }),
        op({ op: "create", ref: "y", parent: "x", title: "Level 3" }),
        op({ op: "create", parent: "y", title: "Level 4" }),
      ],
      ctx,
    );
    expect(plan.creates.map((c) => [c.title, c.depth])).toEqual([
      ["Level 2", 2],
      ["Level 3", 3],
    ]);
    expect(plan.problems).toEqual([
      "“Too deep” would be nested more than 3 levels deep",
      "“Level 4” would be nested more than 3 levels deep",
    ]);
  });

  it("reports unknown parents, handles, labels and dates instead of failing", () => {
    const plan = planOperations(
      [
        op({ op: "create", parent: "zzzzzz", title: "Orphan" }),
        op({ op: "create", date: "tomorrow", title: "Bad date" }),
        op({ op: "create", date: "2026-10-12", title: "Blocked task", status: "Blocked" }),
        op({ op: "update", id: "ffffff", title: "Ghost" }),
        op({ op: "delete", id: "ffffff" }),
      ],
      ctx,
    );
    expect(plan.creates.map((c) => c.title)).toEqual(["Blocked task"]);
    expect(plan.creates[0].statusId).toBeUndefined(); // falls back to the default status
    expect(plan.problems).toEqual([
      "I couldn't find where to put the sub-note “Orphan”",
      "“Bad date” had no valid date",
      "there is no status called “Blocked”",
      "I couldn't find the task to rename to “Ghost”",
      "I couldn't find one of the tasks to delete",
    ]);
  });

  it("maps label names case-insensitively and 'none' to clearing", () => {
    const plan = planOperations(
      [
        op({ op: "update", id: "bbbbbb", status: "done", priority: "none", date: "2026-10-20", description: "" }),
        op({ op: "create", date: "2026-10-12", title: "T", priority: "HIGH" }),
      ],
      ctx,
    );
    expect(plan.updates[0]).toMatchObject({
      id: "id-b",
      fromDate: "2026-10-13",
      patch: { statusId: "s-done", priorityId: null, date: "2026-10-20", description: null },
    });
    expect(plan.creates[0].priorityId).toBe("p-high");
  });

  it("counts deletes including sub-notes and skips ones inside another deleted subtree", () => {
    const plan = planOperations(
      [op({ op: "delete", id: "a1a1a1" }), op({ op: "delete", id: "aaaaaa" }), op({ op: "delete", id: "aaaaaa" })],
      ctx,
    );
    expect(plan.deletes.map((d) => d.id)).toEqual(["id-a"]);
    expect(plan.deleteTotal).toBe(3);
  });

  it("doesn't update a task that is being deleted", () => {
    const plan = planOperations([op({ op: "update", id: "a1a1a1", title: "X" }), op({ op: "delete", id: "aaaaaa" })], ctx);
    expect(plan.updates).toEqual([]);
  });
});

describe("classifyConfirmation", () => {
  it.each(["Yes.", "yes please", "Yeah, go ahead!", "Sure", "OK", "Okay delete them", "Confirm", "Do it"])(
    "%s → yes",
    (t) => expect(classifyConfirmation(t)).toBe("yes"),
  );
  it.each(["No.", "Nope", "Cancel", "Don't delete them", "Wait", "never mind", "Keep them"])("%s → no", (t) =>
    expect(classifyConfirmation(t)).toBe("no"),
  );
  it.each(["Add milk tomorrow", "yes and also add a gym session on Friday with high priority please", "Sure not"])(
    "%s → other",
    (t) => expect(classifyConfirmation(t)).toBe("other"),
  );
});

describe("composeReply", () => {
  const created: AssistantChange = { kind: "created", taskId: "t1", title: "A", date: "2026-10-12" };

  it("uses the model's reply when everything went through", () => {
    expect(composeReply("Added it for today.", [created], [], null)).toBe("Added it for today.");
  });

  it("describes what actually happened when something failed", () => {
    expect(composeReply("All done!", [created], ["there is no status called “Blocked”"], null)).toBe(
      "I added 1 task. But there is no status called “Blocked”.",
    );
    expect(composeReply("All done!", [], ["I couldn't find one of the tasks to delete"], null)).toBe(
      "I couldn't find one of the tasks to delete.",
    );
  });

  it("asks for confirmation when tasks with sub-notes are held", () => {
    expect(composeReply("Deleted it.", [created], [], { ids: ["a"], titles: ["Portfolio"], total: 3 })).toBe(
      "I added 1 task. “Portfolio” has 2 sub-notes. Delete it together with them? Say yes or tap Delete.",
    );
    expect(composeReply("Deleted them.", [], [], { ids: ["a", "b"], titles: ["Gym", "Portfolio"], total: 4 })).toBe(
      "“Gym” and “Portfolio” have 2 sub-notes between them. Delete them together with their sub-notes? Say yes or tap Delete.",
    );
  });
});

describe("incomplete replies and spoken task lists", () => {
  it("detects replies that only announce information", () => {
    expect(isIncompleteReply("Here are the tasks you recorded in June 2026:")).toBe(true);
    expect(isIncompleteReply("  ")).toBe(true);
    expect(isIncompleteReply("In June you had one task.")).toBe(false);
  });

  const t = (title: string, date: string, parentId: string | null = null) => ({
    id: title,
    title,
    date,
    parentId,
    depth: parentId ? 1 : 0,
    description: null,
    statusId: null,
    priorityId: null,
    sortOrder: 0,
    createdAt: "",
    updatedAt: "",
  });

  it("lists top-level tasks in date order with spoken dates", () => {
    expect(spokenTaskList([t("B", "2026-06-14"), t("A", "2026-06-03"), t("sub", "2026-06-03", "A")])).toBe(
      "I found 2 tasks: A on Wednesday, June 3rd; and B on Sunday, June 14th.",
    );
  });

  it("caps long lists and handles none", () => {
    const many = Array.from({ length: 9 }, (_, i) => t(`T${i}`, `2026-06-${String(i + 1).padStart(2, "0")}`));
    expect(spokenTaskList(many)).toMatch(/^I found 9 tasks: .*, and 3 more\.$/);
    expect(spokenTaskList([])).toBe("I didn't find any tasks for that.");
  });
});
