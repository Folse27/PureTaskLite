import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@/lib/types";
import { compactForHistory, hasPriorAssistantReply, systemPrompt, trimHistory } from "./conversation";

const user = (content: string): ChatMessage => ({ role: "user", content });
const reply = (content: string): ChatMessage => ({ role: "assistant", content });
const call = (id: string): ChatMessage => ({
  role: "assistant",
  content: null,
  tool_calls: [{ id, type: "function", function: { name: "list_tasks", arguments: "{}" } }],
});
const result = (id: string, content = "{}"): ChatMessage => ({ role: "tool", tool_call_id: id, content });

describe("trimHistory", () => {
  it("keeps short histories unchanged", () => {
    const h = [user("a"), reply("b")];
    expect(trimHistory(h, 10)).toBe(h);
  });

  it("cuts at a user message so tool calls keep their results", () => {
    const h = [user("1"), call("x"), result("x"), reply("r1"), user("2"), call("y"), result("y"), reply("r2")];
    const trimmed = trimHistory(h, 6);
    expect(trimmed[0]).toEqual(user("2"));
    expect(trimmed).toHaveLength(4);
  });
});

describe("compactForHistory", () => {
  it("truncates long tool results only", () => {
    const long = "x".repeat(10_000);
    const [u, t] = compactForHistory([user(long), result("x", long)]);
    expect((u as { content: string }).content).toHaveLength(10_000);
    expect((t as { content: string }).content.length).toBeLessThan(4100);
  });
});

describe("hasPriorAssistantReply", () => {
  it("requires a spoken assistant reply, not just tool calls", () => {
    expect(hasPriorAssistantReply([])).toBe(false);
    expect(hasPriorAssistantReply([user("a"), call("x"), result("x")])).toBe(false);
    expect(hasPriorAssistantReply([user("a"), reply("Delete these 3 tasks?")])).toBe(true);
  });
});

describe("systemPrompt", () => {
  it("includes today's date, weekday and timezone", () => {
    const prompt = systemPrompt(new Date("2026-10-12T08:41:00Z"));
    expect(prompt).toContain("Today is 2026-10-12 (Monday)");
    expect(prompt).toContain("Europe/Berlin");
    expect(prompt).toContain("Monday, 12 October 2026, 10:41");
    expect(prompt).toContain("Friday 2026-10-16");
    expect(prompt).toContain("Friday 2026-10-23");
  });
});
