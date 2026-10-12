import "server-only";
import { todayISO } from "@/lib/dates";
import { listLabels } from "@/lib/server/labels";
import { HttpError } from "@/lib/server/http";
import type { AssistantChange, ChatMessage, PendingDelete } from "@/lib/types";
import { systemPrompt, trimHistory } from "./conversation";
import { chatJson, type ChatRole } from "./groq";
import {
  classifyConfirmation,
  composeReply,
  handlesIn,
  historyNote,
  isIncompleteReply,
  modelResponseSchema,
  planOperations,
  RESPONSE_JSON_SCHEMA,
  spokenTaskList,
  summarize,
  type ModelResponse,
} from "./plan";
import { findMentionedRanges } from "./date-refs";
import { handleOf } from "./snapshot";
import { deleteConfirmed, executePlan, loadRanges, loadSnapshot, lookupTasks, resolveHandles } from "./store";

/** Stay well inside the route's 60 s limit, including time spent waiting out rate limits. */
const TIME_BUDGET_MS = 50_000;

export interface AssistantRequest {
  text: string;
  history: ChatMessage[];
  /** Deletions held back in the previous turn, awaiting "yes". */
  pendingDelete?: PendingDelete | null;
}

export interface AssistantResult {
  reply: string;
  changes: AssistantChange[];
  /** Updated conversation for the client to send next time. */
  history: ChatMessage[];
  /** Set when deletions wait for the user's confirmation. */
  pendingDelete: PendingDelete | null;
}

function finish(
  request: AssistantRequest,
  reply: string,
  changes: AssistantChange[],
  pendingDelete: PendingDelete | null = null,
): AssistantResult {
  const history: ChatMessage[] = [
    ...trimHistory(request.history),
    { role: "user", content: request.text },
    { role: "assistant", content: reply + historyNote(changes, pendingDelete, handleOf) },
  ];
  return { reply, changes, history, pendingDelete };
}

async function ask(messages: { role: ChatRole; content: string }[], deadline: number): Promise<ModelResponse> {
  const raw = await chatJson({ messages, schema: RESPONSE_JSON_SCHEMA, deadline });
  const parsed = modelResponseSchema.safeParse(raw);
  if (!parsed.success) {
    console.error("[assistant] Model output didn't match the expected shape:", JSON.stringify(raw).slice(0, 500));
    throw new HttpError(502, "I got confused by that one. Please try again.");
  }
  return parsed.data;
}

/**
 * One request in, one JSON answer out: the model returns its reply plus every
 * operation at once, and the server applies them in a single transaction.
 * A second model call happens only when the model asks to look up tasks that
 * weren't in the task list it was given.
 */
export async function runAssistant(request: AssistantRequest): Promise<AssistantResult> {
  // Answer to "Should I delete …?" — handled without the model.
  if (request.pendingDelete) {
    const answer = classifyConfirmation(request.text);
    if (answer === "yes") {
      const changes = await deleteConfirmed(request.pendingDelete.ids);
      const reply = changes.length ? `Done, I ${summarize(changes)}.` : "Those tasks were already gone.";
      return finish(request, reply, changes);
    }
    if (answer === "no") return finish(request, "Okay, I won't delete anything.", []);
    // Anything else: drop the held deletes and treat it as a new request.
  }

  const deadline = Date.now() + TIME_BUDGET_MS;
  const today = todayISO();
  const [statuses, priorities] = await Promise.all([listLabels("statuses"), listLabels("priorities")]);
  const labels = { statuses, priorities };
  const snapshot = await loadSnapshot(today, labels);

  // Months the user mentioned ("What did I do in June?") go into the prompt up front.
  const ranges = findMentionedRanges(request.text, today);
  const mentioned = ranges.length ? await loadRanges(ranges, today, labels) : null;
  const sections: { title: string; body: string }[] = mentioned
    ? [{ title: "Complete task lists for the months the user mentioned (including sub-notes):", body: mentioned.text }]
    : [];
  const contextTasks = [...(mentioned?.tasks ?? [])];

  const build = () => [
    {
      role: "system" as const,
      content: systemPrompt(
        new Date(),
        { statuses: labels.statuses.map((l) => l.name), priorities: labels.priorities.map((l) => l.name) },
        snapshot,
        sections,
      ),
    },
    ...trimHistory(request.history),
    { role: "user" as const, content: request.text },
  ];

  let response = await ask(build(), deadline);
  let lookedUp = false;
  if (response.lookup) {
    // Ask again with the results as context — not as a continuation of the first answer,
    // which tends to make the model repeat its placeholder reply.
    const found = await lookupTasks(response.lookup, today, labels);
    contextTasks.push(...found.tasks);
    const what = [response.lookup.query && `"${response.lookup.query}"`, response.lookup.from, response.lookup.to]
      .filter(Boolean)
      .join(" ");
    sections.push({
      title: `Lookup results for ${what} (complete; answer from these, "lookup" must be null):`,
      body: found.text,
    });
    response = await ask(build(), deadline);
    lookedUp = true;
  }
  console.info(
    `[assistant] months=${ranges.map((r) => r.label).join("|") || "-"} lookup=${lookedUp} ops=${response.operations.length}`,
  );

  const known = await resolveHandles(handlesIn(response.operations));
  const plan = planOperations(response.operations, { known, ...labels });

  // Tasks without sub-notes are deleted right away; a task with sub-notes waits for "yes" (or the Delete button).
  const held = plan.deletes.filter((d) => d.count > 1);
  const pendingDelete: PendingDelete | null = held.length
    ? { ids: held.map((d) => d.id), titles: held.map((d) => d.title), total: held.reduce((n, d) => n + d.count, 0) }
    : null;

  let changes: AssistantChange[];
  try {
    changes = await executePlan(plan, { holdDeleteIds: new Set(held.map((d) => d.id)) });
  } catch (error) {
    console.error("[assistant] Applying the plan failed; nothing was changed:", error);
    throw new HttpError(500, "Something went wrong while saving, so nothing was changed. Please try again.");
  }

  let reply = composeReply(response.reply, changes, plan.problems, pendingDelete);
  // Safety net: a question answered with nothing (or "Here are your tasks:") gets the list we already have.
  if (response.operations.length === 0 && isIncompleteReply(reply) && (ranges.length > 0 || lookedUp)) {
    reply = spokenTaskList(contextTasks);
  }
  return finish(request, reply, changes, pendingDelete);
}
