import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessage, Task } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  chatCompletion: vi.fn(),
  createTask: vi.fn(),
  deleteTask: vi.fn(),
  getTask: vi.fn(),
  subtreeSize: vi.fn(),
  listLabels: vi.fn(),
}));

vi.mock("./groq", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./groq")>()),
  chatCompletion: mocks.chatCompletion,
}));
vi.mock("@/lib/server/tasks", () => ({
  createTask: mocks.createTask,
  deleteTask: mocks.deleteTask,
  getTask: mocks.getTask,
  subtreeSize: mocks.subtreeSize,
  listTasks: vi.fn(async () => []),
  searchTasks: vi.fn(async () => []),
  updateTask: vi.fn(),
}));
vi.mock("@/lib/server/labels", () => ({ listLabels: mocks.listLabels }));

const { runAssistant } = await import("./assistant");
const { GroqError } = await import("./groq");

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

function task(id: string, title: string): Task {
  return {
    id,
    title,
    date: "2026-10-12",
    parentId: null,
    depth: 0,
    description: null,
    statusId: null,
    priorityId: null,
    sortOrder: 0,
    createdAt: "2026-10-12T00:00:00Z",
    updatedAt: "2026-10-12T00:00:00Z",
  };
}

const call = (id: string, name: string, args: object) => ({
  id,
  type: "function" as const,
  function: { name, arguments: JSON.stringify(args) },
});
const toolStep = (...calls: ReturnType<typeof call>[]) => ({
  message: { role: "assistant", content: null, tool_calls: calls },
  finishReason: "tool_calls",
});
const answer = (content: string) => ({ message: { role: "assistant", content }, finishReason: "stop" });

const toolResults = (history: ChatMessage[]) =>
  history.filter((m): m is Extract<ChatMessage, { role: "tool" }> => m.role === "tool").map((m) => JSON.parse(m.content));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listLabels.mockImplementation(async (kind: string) =>
    kind === "statuses"
      ? [{ id: "s1", name: "To do", color: "#8E8E93", sortOrder: 0 }]
      : [{ id: "p1", name: "High", color: "#FF9500", sortOrder: 0 }],
  );
  mocks.getTask.mockImplementation(async (id: string) => task(id, id === A ? "Dentist" : "Gym"));
  mocks.subtreeSize.mockResolvedValue(1);
  mocks.deleteTask.mockImplementation(async (id: string) => ({ task: task(id, "x"), deletedIds: [id] }));
});

describe("runAssistant tool loop", () => {
  it("executes tool calls until the model answers, and reports changes", async () => {
    mocks.createTask.mockResolvedValue({ ...task(A, "Buy milk"), date: "2026-10-13", priorityId: "p1" });
    mocks.chatCompletion
      .mockResolvedValueOnce(toolStep(call("c1", "create_task", { date: "2026-10-13", title: "Buy milk", priority: "high" })))
      .mockResolvedValueOnce(answer("Added buy milk for tomorrow."));

    const result = await runAssistant("Add buy milk tomorrow, high priority", []);

    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ date: "2026-10-13", title: "Buy milk", priorityId: "p1" }),
    );
    expect(result.reply).toBe("Added buy milk for tomorrow.");
    expect(result.changes).toEqual([{ kind: "created", taskId: A, title: "Buy milk", date: "2026-10-13" }]);
    expect(result.history.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    // The system prompt carries today's date and is sent on every step.
    const firstRequest = mocks.chatCompletion.mock.calls[0][0];
    expect(firstRequest.messages[0].role).toBe("system");
    expect(firstRequest.messages[0].content).toContain("Europe/Berlin");
  });

  it("returns tool errors to the model instead of failing", async () => {
    mocks.chatCompletion
      .mockResolvedValueOnce(toolStep(call("c1", "create_task", { date: "2026-10-13", title: "X", status: "Blocked" })))
      .mockResolvedValueOnce(answer("There is no Blocked status."));
    const result = await runAssistant("add X as blocked", []);
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(toolResults(result.history)[0].error).toMatch(/Unknown status "Blocked". Available: To do/);
  });

  it("stops after a bounded number of steps", async () => {
    mocks.chatCompletion.mockResolvedValue(toolStep(call("c", "list_statuses", {})));
    const result = await runAssistant("loop forever", []);
    expect(mocks.chatCompletion).toHaveBeenCalledTimes(10);
    expect(result.reply).toMatch(/couldn't work that out/);
  });
});

describe("delete confirmation guard", () => {
  it("deletes a single task without sub-notes directly", async () => {
    mocks.chatCompletion
      .mockResolvedValueOnce(toolStep(call("d1", "delete_task", { id: A })))
      .mockResolvedValueOnce(answer("Deleted the dentist."));
    const result = await runAssistant("delete the dentist", []);
    expect(mocks.deleteTask).toHaveBeenCalledWith(A);
    expect(result.changes[0]).toMatchObject({ kind: "deleted", taskId: A });
  });

  it("refuses several deletes in one turn without confirmation", async () => {
    mocks.chatCompletion
      .mockResolvedValueOnce(toolStep(call("d1", "delete_task", { id: A }), call("d2", "delete_task", { id: B })))
      .mockResolvedValueOnce(answer("Should I delete Dentist and Gym?"));
    const result = await runAssistant("delete everything today", []);
    expect(mocks.deleteTask).not.toHaveBeenCalled();
    expect(toolResults(result.history).every((r) => r.error === "confirmation_required")).toBe(true);
    expect(result.changes).toEqual([]);
  });

  it("refuses a second sequential delete in the same turn", async () => {
    mocks.chatCompletion
      .mockResolvedValueOnce(toolStep(call("d1", "delete_task", { id: A })))
      .mockResolvedValueOnce(toolStep(call("d2", "delete_task", { id: B })))
      .mockResolvedValueOnce(answer("Deleted one; confirm the other?"));
    await runAssistant("delete both", []);
    expect(mocks.deleteTask).toHaveBeenCalledTimes(1);
  });

  it("refuses deleting a task with sub-notes unless confirmed after asking", async () => {
    mocks.subtreeSize.mockResolvedValue(3);
    mocks.chatCompletion
      .mockResolvedValueOnce(toolStep(call("d1", "delete_task", { id: A, confirmed: true })))
      .mockResolvedValueOnce(answer("It has 2 sub-notes. Delete all 3?"));
    // No earlier assistant reply → a self-asserted confirmation is not trusted.
    await runAssistant("delete the dentist", []);
    expect(mocks.deleteTask).not.toHaveBeenCalled();

    mocks.chatCompletion
      .mockResolvedValueOnce(toolStep(call("d2", "delete_task", { id: A, confirmed: true })))
      .mockResolvedValueOnce(answer("Done, deleted 3 tasks."));
    const history: ChatMessage[] = [
      { role: "user", content: "delete the dentist" },
      { role: "assistant", content: "It has 2 sub-notes. Delete all 3?" },
    ];
    await runAssistant("yes", history);
    expect(mocks.deleteTask).toHaveBeenCalledWith(A);
  });
});

describe("rate limits", () => {
  const rateLimited = () => new GroqError(429, "busy", "Rate limit reached: tokens per minute", 30);

  it("keeps and reports partial progress when rate-limited midway", async () => {
    mocks.createTask
      .mockResolvedValueOnce(task(A, "Finish portfolio website"))
      .mockResolvedValueOnce(task(B, "Report to client"));
    mocks.chatCompletion
      .mockResolvedValueOnce(
        toolStep(
          call("c1", "create_task", { date: "2026-10-12", title: "Finish portfolio website" }),
          call("c2", "create_task", { date: "2026-10-12", title: "Report to client" }),
        ),
      )
      .mockRejectedValueOnce(rateLimited());

    const result = await runAssistant("portfolio and client report today", []);

    expect(result.partial).toBe(true);
    expect(result.changes).toHaveLength(2);
    expect(result.reply).toMatch(/added 2 tasks.*rate limit.*continue/i);
    // History records the work and ends with a spoken reply, so "continue" picks up from there.
    expect(result.history.map((m) => m.role)).toEqual(["user", "assistant", "tool", "tool", "assistant"]);
  });

  it("still fails when nothing was done yet", async () => {
    mocks.chatCompletion.mockRejectedValueOnce(rateLimited());
    await expect(runAssistant("hi", [])).rejects.toBeInstanceOf(GroqError);
  });

  it("gives the model the status and priority names up front", async () => {
    mocks.chatCompletion.mockResolvedValueOnce(answer("Hi."));
    await runAssistant("hi", []);
    const prompt = mocks.chatCompletion.mock.calls[0][0].messages[0].content;
    expect(prompt).toContain("Statuses (in order; new tasks get the first): To do.");
    expect(prompt).toContain("Priorities: High.");
    expect(prompt).toMatch(/put ALL independent tool calls in the same response/);
  });
});
