import { z } from "zod";
import { APP_TIME_ZONE, describeToday } from "@/lib/dates";
import type { ChatMessage } from "@/lib/types";

export const MAX_HISTORY_MESSAGES = 40;
const MAX_TOOL_RESULT_CHARS = 4000;

const toolCall = z.object({
  id: z.string().max(200),
  type: z.literal("function"),
  function: z.object({ name: z.string().max(100), arguments: z.string().max(20_000) }),
});

export const chatMessageSchema: z.ZodType<ChatMessage> = z.union([
  z.object({ role: z.literal("user"), content: z.string().max(4000) }),
  z.object({
    role: z.literal("assistant"),
    content: z.string().max(8000).nullable(),
    tool_calls: z.array(toolCall).max(20).optional(),
  }),
  z.object({ role: z.literal("tool"), tool_call_id: z.string().max(200), content: z.string().max(20_000) }),
]);

export const assistantInput = z.object({
  text: z.string().trim().min(1, "Say something first.").max(2000),
  history: z.array(chatMessageSchema).max(200).default([]),
});

/**
 * Keeps the most recent messages, cutting only at a user message so that an
 * assistant tool call is never separated from its tool results.
 */
export function trimHistory(messages: ChatMessage[], max = MAX_HISTORY_MESSAGES): ChatMessage[] {
  if (messages.length <= max) return messages;
  for (let start = messages.length - max; start < messages.length; start++) {
    if (messages[start].role === "user") return messages.slice(start);
  }
  return [];
}

/** Shortens bulky tool results before they are stored in the client's history. */
export function compactForHistory(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) =>
    m.role === "tool" && m.content.length > MAX_TOOL_RESULT_CHARS
      ? { ...m, content: `${m.content.slice(0, MAX_TOOL_RESULT_CHARS)}… [truncated]` }
      : m,
  );
}

/** True if an earlier assistant reply exists (i.e. the assistant could have asked for confirmation). */
export function hasPriorAssistantReply(history: ChatMessage[]): boolean {
  return history.some((m) => m.role === "assistant" && !!m.content?.trim());
}

export function systemPrompt(
  now: Date = new Date(),
  labels?: { statuses: string[]; priorities: string[] },
): string {
  const d = describeToday(now);
  const names = (list: string[]) => (list.length ? list.join(", ") : "(none defined)");
  const labelLine = labels
    ? `- Statuses (in order; new tasks get the first): ${names(labels.statuses)}. Priorities: ${names(labels.priorities)}. Use these exact names.`
    : "- Statuses and priorities are user-defined; use the names returned by list_statuses / list_priorities.";
  return `You are the voice planning assistant in "PureTask Lite", a personal day planner. The user speaks to you; your reply is read aloud.

Now: ${d.long}, ${d.time} (${APP_TIME_ZONE}). Today is ${d.today} (${d.weekday}).
Weeks run Monday to Sunday.
This week: ${d.thisWeek.join(", ")}.
Next week: ${d.nextWeek.join(", ")}.

Resolve relative dates against this calendar: "today", "tomorrow", "yesterday", "this Friday" (the Friday of this week), "next Friday" (the first Friday after today), "this week", "next week", "in two weeks", "the weekend" (Saturday and Sunday). When you act on a date, mention it naturally in your reply (e.g. "Friday the 16th") so the user can correct you.

How the planner works:
- Every task belongs to one day. A task can have sub-notes nested at most 3 levels below the top-level task (parent_id links them). Sub-notes share their top-level task's date.
${labelLine}

Rules:
- Work in as few steps as possible: put ALL independent tool calls in the same response. Example: to add a task with a sub-note plus a task on each day Monday–Friday, create every top-level task in one response, then add the sub-notes (they need the parent id) in the next.
- Creating new tasks needs no lookup first. Before changing or deleting existing tasks, find them with list_tasks or search_tasks, or take ids from earlier in this conversation (e.g. "move that one to tomorrow"). Never invent ids.
- If the conversation shows an earlier request was only partly done, continue from where it stopped; don't redo what's already created.
- Deletions: if a request would delete more than one task in total (several tasks, or one task that has sub-notes), do not delete anything yet. Tell the user exactly what would be deleted and ask them to confirm. Only after they confirm in their next message, call delete_task with confirmed=true. A single task without sub-notes may be deleted directly.
- If a tool returns an error, fix the call or explain the problem briefly.
- If the request is ambiguous, ask one short question instead of guessing.

Reply style: spoken English, 1–3 short sentences, plain text only — no markdown, lists, ids, or emoji.`;
}
