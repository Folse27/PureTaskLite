import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Label } from "@/lib/types";
import type { KnownTask } from "./plan";

const mocks = vi.hoisted(() => ({
  chatJson: vi.fn(),
  listLabels: vi.fn(),
  loadSnapshot: vi.fn(),
  resolveHandles: vi.fn(),
  lookupTasks: vi.fn(),
  loadRanges: vi.fn(),
  executePlan: vi.fn(),
  deleteConfirmed: vi.fn(),
}));

vi.mock("./groq", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./groq")>()),
  chatJson: mocks.chatJson,
}));
vi.mock("@/lib/server/labels", () => ({ listLabels: mocks.listLabels }));
vi.mock("./store", () => ({
  loadSnapshot: mocks.loadSnapshot,
  resolveHandles: mocks.resolveHandles,
  lookupTasks: mocks.lookupTasks,
  loadRanges: mocks.loadRanges,
  executePlan: mocks.executePlan,
  deleteConfirmed: mocks.deleteConfirmed,
}));

const { runAssistant } = await import("./assistant");
const { GroqError } = await import("./groq");

const statuses: Label[] = [{ id: "s1", name: "To do", color: "#8E8E93", sortOrder: 0 }];
const priorities: Label[] = [{ id: "p1", name: "High", color: "#FF9500", sortOrder: 0 }];

const NULLS = {
  ref: null,
  id: null,
  parent: null,
  date: null,
  title: null,
  description: null,
  status: null,
  priority: null,
};
const NO_LOOKUP = { query: null, from: null, to: null };
const answer = (reply: string, operations: object[] = [], lookup: object = NO_LOOKUP) => ({
  reply,
  operations: operations.map((o) => ({ ...NULLS, ...o })),
  lookup,
});

const UUID_A = "aaaaaaaa-0000-4000-8000-000000000001";
const UUID_B = "bbbbbbbb-0000-4000-8000-000000000002";
const knownA: KnownTask = {
  id: UUID_A,
  title: "Portfolio",
  date: "2026-10-12",
  depth: 0,
  subtreeIds: [UUID_A, "c1", "c2"],
};
const knownB: KnownTask = { id: UUID_B, title: "Gym", date: "2026-10-13", depth: 0, subtreeIds: [UUID_B] };
const UUID_C = "cccccccc-0000-4000-8000-000000000003";
const knownC: KnownTask = { id: UUID_C, title: "Homework", date: "2026-10-14", depth: 0, subtreeIds: [UUID_C] };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listLabels.mockImplementation(async (kind: string) => (kind === "statuses" ? statuses : priorities));
  mocks.loadSnapshot.mockResolvedValue("SNAPSHOT");
  mocks.resolveHandles.mockImplementation(async (handles: string[]) => {
    const all = new Map([
      ["aaaaaa", knownA],
      ["bbbbbb", knownB],
      ["cccccc", knownC],
    ]);
    return new Map(handles.filter((h) => all.has(h)).map((h) => [h, all.get(h)!]));
  });
  // Mimics the real store: creates, then deletes that aren't held for confirmation.
  mocks.executePlan.mockImplementation(
    async (
      plan: {
        creates: { title: string; date: string | null }[];
        deletes: { id: string; title: string; date: string; count: number }[];
      },
      options: { holdDeleteIds: ReadonlySet<string> },
    ) => [
      ...plan.creates.map((c, i) => ({
        kind: "created",
        taskId: `${i}0000000-new`,
        title: c.title,
        date: c.date ?? "2026-10-12",
      })),
      ...plan.deletes
        .filter((d) => !options.holdDeleteIds.has(d.id))
        .map((d) => ({ kind: "deleted", taskId: d.id, title: d.title, date: d.date, count: d.count })),
    ],
  );
});

describe("runAssistant", () => {
  it("handles a multi-task request with exactly one model call", async () => {
    mocks.chatJson.mockResolvedValueOnce(
      answer("Added your portfolio task with a sub-note, and homework help through Friday.", [
        { op: "create", ref: "p", date: "2026-10-12", title: "Finish portfolio website" },
        { op: "create", parent: "p", title: "Create thumbnails" },
        ...["12", "13", "14", "15", "16"].map((d) => ({
          op: "create",
          date: `2026-10-${d}`,
          title: "Help friend with homework",
        })),
      ]),
    );

    const result = await runAssistant({ text: "portfolio, thumbnails, homework all week", history: [] });

    expect(mocks.chatJson).toHaveBeenCalledTimes(1);
    expect(mocks.executePlan).toHaveBeenCalledTimes(1);
    const [plan, options] = mocks.executePlan.mock.calls[0];
    expect(plan.creates).toHaveLength(7);
    expect(options).toEqual({ holdDeleteIds: new Set() });
    expect(result.reply).toBe("Added your portfolio task with a sub-note, and homework help through Friday.");
    expect(result.changes).toHaveLength(7);
    expect(result.pendingDelete).toBeNull();

    // The prompt carries the snapshot; the history records what was done (with handles) for follow-ups.
    const messages = mocks.chatJson.mock.calls[0][0].messages;
    expect(messages[0].content).toContain("SNAPSHOT");
    expect(messages.at(-1)).toEqual({ role: "user", content: "portfolio, thumbnails, homework all week" });
    expect(result.history).toHaveLength(2);
    expect(result.history[1].content).toMatch(/\[added 000000 "Finish portfolio website" on 2026-10-12;/);
  });

  it("answers questions with an empty operations table", async () => {
    mocks.chatJson.mockResolvedValueOnce(answer("You have two tasks today."));
    const result = await runAssistant({ text: "what's on today?", history: [] });
    expect(result.reply).toBe("You have two tasks today.");
    expect(mocks.executePlan).toHaveBeenCalledWith(expect.objectContaining({ creates: [], deletes: [] }), {
      holdDeleteIds: new Set(),
    });
  });

  it("does a second call only when the model asks for a lookup", async () => {
    mocks.lookupTasks.mockResolvedValueOnce({ text: "LOOKUP-RESULTS", tasks: [] });
    mocks.chatJson
      .mockResolvedValueOnce(answer("", [], { query: "dentist", from: null, to: null }))
      .mockResolvedValueOnce(
        answer("Moved the dentist to Friday.", [{ op: "update", id: "bbbbbb", date: "2026-10-16" }]),
      );

    const result = await runAssistant({ text: "move the dentist in March to Friday", history: [] });

    expect(mocks.lookupTasks).toHaveBeenCalledWith(
      { query: "dentist", from: undefined, to: undefined },
      expect.any(String),
      {
        statuses,
        priorities,
      },
    );
    expect(mocks.chatJson).toHaveBeenCalledTimes(2);
    // The retry carries the results in its context and does NOT replay the first (placeholder) answer.
    const retry = mocks.chatJson.mock.calls[1][0].messages;
    expect(retry[0].content).toContain("LOOKUP-RESULTS");
    expect(retry.map((m: { role: string }) => m.role)).toEqual(["system", "user"]);
    expect(result.reply).toBe("Moved the dentist to Friday.");
  });

  it("deletes several tasks without sub-notes right away, without asking", async () => {
    mocks.chatJson.mockResolvedValueOnce(
      answer("Deleted your gym session and homework.", [
        { op: "delete", id: "bbbbbb" },
        { op: "delete", id: "cccccc" },
      ]),
    );
    const result = await runAssistant({ text: "delete gym and homework", history: [] });

    expect(mocks.executePlan.mock.calls[0][1]).toEqual({ holdDeleteIds: new Set() });
    expect(result.changes.map((c) => c.kind)).toEqual(["deleted", "deleted"]);
    expect(result.pendingDelete).toBeNull();
    expect(result.reply).toBe("Deleted your gym session and homework.");
  });

  it("holds only tasks that have sub-notes, deleting the rest right away", async () => {
    mocks.chatJson.mockResolvedValueOnce(
      answer("Done!", [
        { op: "delete", id: "aaaaaa" },
        { op: "delete", id: "bbbbbb" },
        { op: "create", date: "2026-10-12", title: "New thing" },
      ]),
    );
    const result = await runAssistant({ text: "delete the portfolio and gym, add a new thing", history: [] });

    expect(mocks.executePlan.mock.calls[0][1]).toEqual({ holdDeleteIds: new Set([UUID_A]) });
    expect(result.pendingDelete).toEqual({ ids: [UUID_A], titles: ["Portfolio"], total: 3 });
    expect(result.reply).toBe(
      "I added 1 task and deleted 1 task. “Portfolio” has 2 sub-notes. Delete it together with them? Say yes or tap Delete.",
    );
    expect(result.history[1].content).toContain("waiting for confirmation to delete aaaaaa");
  });

  it("confirms held deletes on 'yes' without calling the model", async () => {
    mocks.deleteConfirmed.mockResolvedValueOnce([
      { kind: "deleted", taskId: UUID_A, title: "Portfolio", date: "2026-10-12", count: 3 },
    ]);
    const pendingDelete = { ids: [UUID_A], titles: ["Portfolio"], total: 3 };
    const result = await runAssistant({ text: "Yes, please.", history: [], pendingDelete });

    expect(mocks.chatJson).not.toHaveBeenCalled();
    expect(mocks.deleteConfirmed).toHaveBeenCalledWith([UUID_A]);
    expect(result.reply).toBe("Done, I deleted 3 tasks.");
    expect(result.pendingDelete).toBeNull();
  });

  it("cancels held deletes on 'no'", async () => {
    const result = await runAssistant({
      text: "No, keep them",
      history: [],
      pendingDelete: { ids: [UUID_A], titles: ["Portfolio"], total: 3 },
    });
    expect(mocks.chatJson).not.toHaveBeenCalled();
    expect(mocks.deleteConfirmed).not.toHaveBeenCalled();
    expect(result.reply).toBe("Okay, I won't delete anything.");
  });

  it("treats anything else as a new request and drops the held deletes", async () => {
    mocks.chatJson.mockResolvedValueOnce(answer("Added milk."));
    const result = await runAssistant({
      text: "add milk tomorrow",
      history: [],
      pendingDelete: { ids: [UUID_A], titles: ["Portfolio"], total: 3 },
    });
    expect(mocks.chatJson).toHaveBeenCalledTimes(1);
    expect(mocks.deleteConfirmed).not.toHaveBeenCalled();
    expect(result.pendingDelete).toBeNull();
  });

  it("tells the user what failed instead of trusting the model's reply", async () => {
    mocks.chatJson.mockResolvedValueOnce(
      answer("All set!", [
        { op: "create", date: "2026-10-12", title: "Works" },
        { op: "update", id: "ffffff", title: "Ghost" },
      ]),
    );
    const result = await runAssistant({ text: "…", history: [] });
    expect(result.reply).toBe("I added 1 task. But I couldn't find the task to rename to “Ghost”.");
  });

  it("reports a failed save as 'nothing was changed'", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.chatJson.mockResolvedValueOnce(answer("Added.", [{ op: "create", date: "2026-10-12", title: "X" }]));
    mocks.executePlan.mockRejectedValueOnce(new Error("db down"));
    await expect(runAssistant({ text: "add x", history: [] })).rejects.toMatchObject({
      status: 500,
      message: expect.stringMatching(/nothing was changed/),
    });
  });

  it("passes Groq errors (e.g. rate limits) through untouched", async () => {
    mocks.chatJson.mockRejectedValueOnce(new GroqError(429, "busy", "tokens per minute"));
    await expect(runAssistant({ text: "hi", history: [] })).rejects.toBeInstanceOf(GroqError);
    expect(mocks.executePlan).not.toHaveBeenCalled();
  });

  it("rejects malformed model output", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.chatJson.mockResolvedValueOnce({ reply: 5, operations: "lots" });
    await expect(runAssistant({ text: "hi", history: [] })).rejects.toMatchObject({ status: 502 });
  });

  it("answers a month question in one call, with that month's tasks in the prompt", async () => {
    mocks.loadRanges.mockResolvedValueOnce({ text: "JUNE-TASKS", tasks: [] });
    mocks.chatJson.mockResolvedValueOnce(
      answer("In June you had one task: Book dentist appointment on Wednesday the 3rd."),
    );

    const result = await runAssistant({ text: "What did I do in June, 2026?", history: [] });

    expect(mocks.loadRanges.mock.calls[0][0]).toEqual([{ from: "2026-06-01", to: "2026-06-30", label: "June 2026" }]);
    expect(mocks.chatJson).toHaveBeenCalledTimes(1);
    expect(mocks.chatJson.mock.calls[0][0].messages[0].content).toContain("JUNE-TASKS");
    expect(result.reply).toBe("In June you had one task: Book dentist appointment on Wednesday the 3rd.");
  });

  it("replaces a reply that only announces a list with the actual tasks", async () => {
    mocks.loadRanges.mockResolvedValueOnce({
      text: "JUNE-TASKS",
      tasks: [
        {
          id: UUID_A,
          date: "2026-06-03",
          parentId: null,
          depth: 0,
          title: "Book dentist appointment",
          description: null,
          statusId: "s1",
          priorityId: null,
          sortOrder: 0,
          createdAt: "",
          updatedAt: "",
        },
      ],
    });
    mocks.chatJson.mockResolvedValueOnce(answer("Here are the tasks you recorded in June 2026:"));
    const result = await runAssistant({ text: "What did I do in June 2026?", history: [] });
    expect(result.reply).toBe("I found 1 task: Book dentist appointment on Wednesday, June 3rd.");
  });

  it("doesn't load months when none are mentioned", async () => {
    mocks.chatJson.mockResolvedValueOnce(answer("Added."));
    await runAssistant({ text: "add milk tomorrow", history: [] });
    expect(mocks.loadRanges).not.toHaveBeenCalled();
  });
});
