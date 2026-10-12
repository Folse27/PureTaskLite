import "server-only";
import type { AssistantChange, ChatMessage } from "@/lib/types";
import { compactForHistory, hasPriorAssistantReply, systemPrompt, trimHistory } from "./conversation";
import { chatCompletion, GroqError } from "./groq";
import { executeTool, labels, TOOL_DEFINITIONS, type ToolContext } from "./tools";

const MAX_STEPS = 10;
/** Stay well inside the route's 60 s limit, including time spent waiting out rate limits. */
const TIME_BUDGET_MS = 50_000;

export interface AssistantResult {
  reply: string;
  changes: AssistantChange[];
  /** Updated conversation (without the system prompt) for the client to send next time. */
  history: ChatMessage[];
  /** True when the turn stopped early (rate limit) after doing part of the work. */
  partial?: boolean;
}

const VERB: Record<AssistantChange["kind"], string> = {
  created: "added",
  updated: "updated",
  moved: "moved",
  deleted: "deleted",
};

/** "added 3 tasks and moved 1 task" */
function summarize(changes: AssistantChange[]): string {
  const counts = new Map<string, number>();
  for (const c of changes) counts.set(VERB[c.kind], (counts.get(VERB[c.kind]) ?? 0) + 1);
  const parts = [...counts].map(([verb, n]) => `${verb} ${n} task${n === 1 ? "" : "s"}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
}

/** Runs the tool-calling loop until the model produces a final answer. */
export async function runAssistant(text: string, previous: ChatMessage[]): Promise<AssistantResult> {
  const deadline = Date.now() + TIME_BUDGET_MS;
  const history: ChatMessage[] = [...trimHistory(previous), { role: "user", content: text }];
  const ctx: ToolContext = {
    changes: [],
    deletesThisTurn: 0,
    deleteCallsInBatch: 0,
    canConfirm: hasPriorAssistantReply(previous),
  };
  const { statuses, priorities } = await labels(ctx);
  const system = systemPrompt(new Date(), {
    statuses: statuses.map((l) => l.name),
    priorities: priorities.map((l) => l.name),
  });

  for (let step = 0; step < MAX_STEPS; step++) {
    let message;
    try {
      ({ message } = await chatCompletion({
        messages: [{ role: "system", content: system }, ...history],
        tools: [...TOOL_DEFINITIONS],
        deadline,
      }));
    } catch (error) {
      // Rate-limited midway: keep (and report) what was already done instead of losing it.
      if (error instanceof GroqError && error.status === 429 && ctx.changes.length > 0) {
        const reply =
          `I ${summarize(ctx.changes)}, then hit the AI's rate limit before finishing. ` +
          `Say "continue" in a minute and I'll do the rest.`;
        history.push({ role: "assistant", content: reply });
        return { reply, changes: ctx.changes, history: compactForHistory(history), partial: true };
      }
      throw error;
    }

    const calls = message.tool_calls ?? [];
    history.push(
      calls.length > 0
        ? { role: "assistant", content: message.content, tool_calls: calls }
        : { role: "assistant", content: message.content ?? "" },
    );
    if (calls.length === 0) {
      return {
        reply: message.content?.trim() || "Done.",
        changes: ctx.changes,
        history: compactForHistory(history),
      };
    }

    ctx.deleteCallsInBatch = calls.filter((c) => c.function.name === "delete_task").length;
    // Sequential on purpose: later calls may depend on earlier ones (e.g. create then sub-note).
    for (const call of calls) {
      const content = await executeTool(call.function.name, call.function.arguments, ctx);
      history.push({ role: "tool", tool_call_id: call.id, content });
    }
  }

  const reply = ctx.changes.length
    ? "I made some changes but couldn't finish everything. Please check the plan."
    : "Sorry, I couldn't work that out. Could you say it differently?";
  history.push({ role: "assistant", content: reply });
  return { reply, changes: ctx.changes, history: compactForHistory(history) };
}
