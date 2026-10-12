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
  modelResponseSchema,
  planOperations,
  RESPONSE_JSON_SCHEMA,
  summarize,
  type ModelResponse,
} from "./plan";
import { handleOf } from "./snapshot";
import { deleteConfirmed, executePlan, loadSnapshot, lookupTasks, resolveHandles } from "./store";

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
  const snapshot = await loadSnapshot(today, { statuses, priorities });
  const messages: { role: ChatRole; content: string }[] = [
    {
      role: "system",
      content: systemPrompt(
        new Date(),
        { statuses: statuses.map((l) => l.name), priorities: priorities.map((l) => l.name) },
        snapshot,
      ),
    },
    ...trimHistory(request.history),
    { role: "user", content: request.text },
  ];

  let response = await ask(messages, deadline);
  if (response.lookup) {
    const found = await lookupTasks(response.lookup, today, { statuses, priorities });
    messages.push(
      { role: "assistant", content: JSON.stringify(response) },
      {
        role: "system",
        content: `Lookup results:\n${found}\n\nNow answer the user's request. Set every "lookup" field to null.`,
      },
    );
    response = await ask(messages, deadline);
  }

  const known = await resolveHandles(handlesIn(response.operations));
  const plan = planOperations(response.operations, { known, statuses, priorities });

  const pendingDelete: PendingDelete | null =
    plan.deleteTotal > 1
      ? { ids: plan.deletes.map((d) => d.id), titles: plan.deletes.map((d) => d.title), total: plan.deleteTotal }
      : null;

  let changes: AssistantChange[];
  try {
    changes = await executePlan(plan, { skipDeletes: pendingDelete !== null });
  } catch (error) {
    console.error("[assistant] Applying the plan failed; nothing was changed:", error);
    throw new HttpError(500, "Something went wrong while saving, so nothing was changed. Please try again.");
  }

  return finish(request, composeReply(response.reply, changes, plan.problems, pendingDelete), changes, pendingDelete);
}
