import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/types";
import { assistantInput, systemPrompt, trimHistory } from "./conversation";

const user = (content: string): ChatMessage => ({ role: "user", content });
const reply = (content: string): ChatMessage => ({ role: "assistant", content });

describe("trimHistory", () => {
  it("keeps short histories unchanged", () => {
    const h = [user("a"), reply("b")];
    expect(trimHistory(h, 10)).toBe(h);
  });

  it("keeps the latest messages, starting at a user message", () => {
    const h = [user("1"), reply("r1"), user("2"), reply("r2"), user("3"), reply("r3")];
    expect(trimHistory(h, 3)).toEqual([user("3"), reply("r3")]);
    expect(trimHistory(h, 4)).toEqual([user("2"), reply("r2"), user("3"), reply("r3")]);
  });
});

describe("assistantInput", () => {
  it("drops tool-call messages left over from older sessions", () => {
    const parsed = assistantInput.parse({
      text: " hi ",
      history: [
        { role: "user", content: "add milk" },
        { role: "assistant", content: null, tool_calls: [{ id: "1" }] },
        { role: "tool", tool_call_id: "1", content: "{}" },
        { role: "assistant", content: "Added milk." },
      ],
    });
    expect(parsed.text).toBe("hi");
    expect(parsed.history).toEqual([user("add milk"), reply("Added milk.")]);
  });

  it("validates pending deletes", () => {
    expect(() =>
      assistantInput.parse({ text: "yes", pendingDelete: { ids: ["not-a-uuid"], titles: [], total: 1 } }),
    ).toThrow();
  });
});

describe("systemPrompt", () => {
  const prompt = systemPrompt(
    new Date("2026-10-12T08:41:00Z"),
    { statuses: ["To do", "Done"], priorities: ["High"] },
    "TASK-LIST-HERE",
  );

  it("includes today's date, weekday, timezone and the week calendars", () => {
    expect(prompt).toContain("Today is 2026-10-12 (Monday)");
    expect(prompt).toContain("Europe/Berlin");
    expect(prompt).toContain("Monday, 12 October 2026, 10:41");
    expect(prompt).toContain("Friday 2026-10-16");
    expect(prompt).toContain("Friday 2026-10-23");
  });

  it("includes labels, the JSON contract and the task list", () => {
    expect(prompt).toContain("Statuses (new tasks get the first one): To do, Done.");
    expect(prompt).toContain("ANSWER WITH ONE JSON OBJECT");
    expect(prompt).toContain("Set \"status\" or \"priority\" only when the user mentions them.");
    expect(prompt.endsWith("TASK-LIST-HERE")).toBe(true);
    expect(prompt).toContain("Never write a reply that only announces information");
    expect(prompt).toContain("NEVER ask the user to confirm a deletion yourself");
  });

  it("appends extra task lists after the main one", () => {
    const withMonth = systemPrompt(new Date("2026-10-12T08:41:00Z"), { statuses: [], priorities: [] }, "MAIN", [
      { title: "Months the user mentioned:", body: "June 2026: …" },
    ]);
    expect(withMonth.endsWith("MAIN\n\nMonths the user mentioned:\nJune 2026: …")).toBe(true);
  });
});
