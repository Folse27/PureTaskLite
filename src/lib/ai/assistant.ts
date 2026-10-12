import "server-only";
import type { AssistantChange, ChatMessage } from "@/lib/types";
import { compactForHistory, hasPriorAssistantReply, systemPrompt, trimHistory } from "./conversation";
import { chatCompletion } from "./groq";
import { executeTool, TOOL_DEFINITIONS, type ToolContext } from "./tools";

const MAX_STEPS = 10;

export interface AssistantResult {
  reply: string;
  changes: AssistantChange[];
  /** Updated conversation (without the system prompt) for the client to send next time. */
  history: ChatMessage[];
}

/** Runs the tool-calling loop until the model produces a final answer. */
export async function runAssistant(text: string, previous: ChatMessage[]): Promise<AssistantResult> {
  const history: ChatMessage[] = [...trimHistory(previous), { role: "user", content: text }];
  const ctx: ToolContext = {
    changes: [],
    deletesThisTurn: 0,
    deleteCallsInBatch: 0,
    canConfirm: hasPriorAssistantReply(previous),
  };

  for (let step = 0; step < MAX_STEPS; step++) {
    const { message } = await chatCompletion({
      messages: [{ role: "system", content: systemPrompt() }, ...history],
      tools: [...TOOL_DEFINITIONS],
    });

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
