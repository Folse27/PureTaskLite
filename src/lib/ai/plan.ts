import { z } from "zod";
import { isISODate } from "@/lib/dates";
import { MAX_DEPTH } from "@/lib/depth";
import type { AssistantChange, Label, PendingDelete, TaskPatch } from "@/lib/types";

/*
 * The model answers every request with ONE JSON object: a spoken reply plus a
 * table of operations. The server validates and applies the whole table in a
 * single transaction, so one model call covers any number of changes.
 */

const nullableString = { type: ["string", "null"] };

/** JSON Schema sent to Groq (strict structured outputs: every field required, nullable when unused). */
export const RESPONSE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reply: { type: "string" },
    operations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          op: { type: "string", enum: ["create", "update", "delete"] },
          ref: nullableString,
          id: nullableString,
          parent: nullableString,
          date: nullableString,
          title: nullableString,
          description: nullableString,
          status: nullableString,
          priority: nullableString,
        },
        required: ["op", "ref", "id", "parent", "date", "title", "description", "status", "priority"],
      },
    },
    lookup: {
      type: "object",
      additionalProperties: false,
      properties: { query: nullableString, from: nullableString, to: nullableString },
      required: ["query", "from", "to"],
    },
  },
  required: ["reply", "operations", "lookup"],
} as const;

const optionalText = z.string().nullish().transform((v) => (v == null ? undefined : v.trim()));

const operationSchema = z.object({
  op: z.enum(["create", "update", "delete"]),
  ref: optionalText,
  id: optionalText,
  parent: optionalText,
  date: optionalText,
  title: optionalText,
  description: z.string().nullish().transform((v) => (v == null ? undefined : v.trim())),
  status: optionalText,
  priority: optionalText,
});

/** Lenient parser for the model's output (also used when strict mode isn't available). */
export const modelResponseSchema = z.object({
  reply: z.string().default(""),
  operations: z.array(operationSchema).max(80).default([]),
  lookup: z
    .object({ query: optionalText, from: optionalText, to: optionalText })
    .nullish()
    .transform((l) => (l && (l.query || l.from || l.to) ? l : null)),
});

export type ModelResponse = z.infer<typeof modelResponseSchema>;
export type Operation = ModelResponse["operations"][number];

/* ── Planning ─────────────────────────────────────────────────────────── */

/** An existing task the operations refer to (resolved from its handle by the server). */
export interface KnownTask {
  id: string;
  title: string;
  date: string;
  depth: number;
  /** The task and all its descendants (for deletes). */
  subtreeIds: string[];
}

export type ParentRef = { kind: "existing"; id: string } | { kind: "new"; key: string } | null;

export interface CreateStep {
  key: string;
  parent: ParentRef;
  /** Top-level tasks only; sub-notes take their parent's date. */
  date: string | null;
  depth: number;
  title: string;
  description: string | null;
  /** undefined → default (first) status. */
  statusId: string | null | undefined;
  priorityId: string | null;
}

export interface UpdateStep {
  id: string;
  title: string;
  fromDate: string;
  patch: TaskPatch;
}

export interface DeleteStep {
  id: string;
  title: string;
  date: string;
  count: number;
}

export interface Plan {
  creates: CreateStep[];
  updates: UpdateStep[];
  deletes: DeleteStep[];
  /** Tasks removed by all deletes together, including sub-notes. */
  deleteTotal: number;
  /** Things that couldn't be done, phrased to be read aloud ("couldn't find …"). */
  problems: string[];
}

interface PlanContext {
  /** Existing tasks by the handle (or id) the model used, lower-cased. */
  known: Map<string, KnownTask>;
  statuses: Label[];
  priorities: Label[];
}

const NONE = /^(none|no status|no priority|null|-)$/i;
const quote = (s: string) => `“${s}”`;

/** Collects the handles the server has to resolve before planning. */
export function handlesIn(ops: Operation[]): string[] {
  const refs = new Set(ops.filter((o) => o.op === "create" && o.ref).map((o) => o.ref!.toLowerCase()));
  const handles = new Set<string>();
  for (const o of ops) {
    const value = (o.op === "create" ? o.parent : o.id)?.toLowerCase();
    if (value && !refs.has(value)) handles.add(value);
  }
  return [...handles];
}

/**
 * Validates the model's operations and orders them for execution. Invalid
 * operations are dropped and reported in `problems`; everything else is kept.
 */
export function planOperations(ops: Operation[], ctx: PlanContext): Plan {
  const problems: string[] = [];
  const findLabel = (kind: "status" | "priority", name: string | undefined) => {
    if (name === undefined || name === "") return { value: undefined as string | null | undefined };
    if (NONE.test(name)) return { value: null };
    const list = kind === "status" ? ctx.statuses : ctx.priorities;
    const match = list.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (!match) return { value: undefined, problem: `there is no ${kind} called ${quote(name)}` };
    return { value: match.id };
  };
  const known = (handle: string | undefined) => (handle ? ctx.known.get(handle.toLowerCase()) : undefined);

  // ── creates: resolve parents (existing handle or a ref created in this answer), in dependency order
  type Pending = { op: Operation; key: string };
  let pending: Pending[] = [];
  let counter = 0;
  for (const op of ops) {
    if (op.op !== "create") continue;
    if (!op.title) {
      problems.push("one new task had no title");
      continue;
    }
    pending.push({ op, key: op.ref?.toLowerCase() || `#${++counter}` });
  }

  const creates: CreateStep[] = [];
  const planned = new Map<string, CreateStep>();
  const pendingKeys = new Set(pending.map((p) => p.key));
  let progress = true;
  while (pending.length > 0 && progress) {
    progress = false;
    const next: Pending[] = [];
    for (const item of pending) {
      const { op, key } = item;
      let parent: ParentRef = null;
      let depth = 0;
      if (op.parent) {
        const parentKey = op.parent.toLowerCase();
        const plannedParent = planned.get(parentKey);
        const existing = known(op.parent);
        if (plannedParent) {
          parent = { kind: "new", key: parentKey };
          depth = plannedParent.depth + 1;
        } else if (pendingKeys.has(parentKey) && !existing) {
          next.push(item); // parent appears later in the table; try again next pass
          continue;
        } else if (existing) {
          parent = { kind: "existing", id: existing.id };
          depth = existing.depth + 1;
        } else {
          problems.push(`I couldn't find where to put the sub-note ${quote(op.title!)}`);
          progress = true;
          continue;
        }
        if (depth > MAX_DEPTH) {
          problems.push(`${quote(op.title!)} would be nested more than ${MAX_DEPTH} levels deep`);
          progress = true;
          continue;
        }
      } else if (!op.date || !isISODate(op.date)) {
        problems.push(`${quote(op.title!)} had no valid date`);
        progress = true;
        continue;
      }

      const status = findLabel("status", op.status);
      const priority = findLabel("priority", op.priority);
      for (const p of [status.problem, priority.problem]) if (p) problems.push(p);
      const step: CreateStep = {
        key,
        parent,
        date: parent ? null : op.date!,
        depth,
        title: op.title!.slice(0, 500),
        description: op.description ? op.description.slice(0, 5000) : null,
        statusId: status.value,
        priorityId: priority.value ?? null,
      };
      creates.push(step);
      planned.set(key, step);
      progress = true;
    }
    pending = next;
  }
  for (const { op } of pending) problems.push(`I couldn't place the sub-note ${quote(op.title!)}`);

  // ── updates
  const updates: UpdateStep[] = [];
  for (const op of ops) {
    if (op.op !== "update") continue;
    const target = known(op.id);
    if (!target) {
      problems.push(op.title ? `I couldn't find the task to rename to ${quote(op.title)}` : "I couldn't find one of the tasks to change");
      continue;
    }
    const patch: TaskPatch = {};
    if (op.title) patch.title = op.title.slice(0, 500);
    if (op.description !== undefined) patch.description = op.description ? op.description.slice(0, 5000) : null;
    if (op.date) {
      if (isISODate(op.date)) patch.date = op.date;
      else problems.push(`${quote(target.title)} got an invalid date`);
    }
    const status = findLabel("status", op.status);
    const priority = findLabel("priority", op.priority);
    for (const p of [status.problem, priority.problem]) if (p) problems.push(p);
    if (status.value !== undefined) patch.statusId = status.value;
    if (priority.value !== undefined) patch.priorityId = priority.value;
    if (Object.keys(patch).length === 0) continue;
    updates.push({ id: target.id, title: target.title, fromDate: target.date, patch });
  }

  // ── deletes: skip duplicates and tasks already inside another deleted subtree
  const targets: KnownTask[] = [];
  for (const op of ops) {
    if (op.op !== "delete") continue;
    const target = known(op.id);
    if (!target) problems.push("I couldn't find one of the tasks to delete");
    else if (!targets.some((t) => t.id === target.id)) targets.push(target);
  }
  const deletes: DeleteStep[] = [];
  const removed = new Set<string>();
  for (const t of targets) {
    if (targets.some((other) => other.id !== t.id && other.subtreeIds.includes(t.id))) continue;
    deletes.push({ id: t.id, title: t.title, date: t.date, count: t.subtreeIds.length });
    for (const id of t.subtreeIds) removed.add(id);
  }

  // Don't update tasks that are being deleted anyway.
  return {
    creates,
    updates: updates.filter((u) => !removed.has(u.id)),
    deletes,
    deleteTotal: removed.size,
    problems,
  };
}

/* ── Confirmation of held deletes ─────────────────────────────────────── */

const YES = /^(yes|yeah|yep|yup|sure|ok|okay|confirm|confirmed|correct|absolutely|definitely|go ahead|do it|delete)\b/;
const NO = /^(no|nope|nah|cancel|stop|don'?t|do not|never ?mind|wait|keep)\b/;

/** Interprets the reply to "Should I delete …?" without calling the model. */
export function classifyConfirmation(text: string): "yes" | "no" | "other" {
  const t = text.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();
  const words = t.split(" ").length;
  if (NO.test(t) && words <= 8) return "no";
  if (YES.test(t) && words <= 8 && !/\b(not|don'?t|no)\b/.test(t)) return "yes";
  return "other";
}

/* ── Wording ──────────────────────────────────────────────────────────── */

const VERB: Record<AssistantChange["kind"], string> = {
  created: "added",
  updated: "updated",
  moved: "moved",
  deleted: "deleted",
};

/** "added 3 tasks and moved 1 task" */
export function summarize(changes: AssistantChange[]): string {
  const counts = new Map<string, number>();
  for (const c of changes) {
    const n = c.kind === "deleted" ? (c.count ?? 1) : 1;
    counts.set(VERB[c.kind], (counts.get(VERB[c.kind]) ?? 0) + n);
  }
  const parts = [...counts].map(([verb, n]) => `${verb} ${n} task${n === 1 ? "" : "s"}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? "made no changes");
}

function listTitles(titles: string[]): string {
  const shown = titles.slice(0, 4).map(quote);
  if (titles.length > 4) shown.push(`${titles.length - 4} more`);
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} and ${shown.at(-1)}` : shown[0];
}

export function confirmationQuestion(pending: PendingDelete): string {
  const extra = pending.total - pending.ids.length;
  const subnotes = extra > 0 ? `, including ${extra} sub-note${extra === 1 ? "" : "s"}` : "";
  return `Should I delete ${listTitles(pending.titles)}? That's ${pending.total} task${pending.total === 1 ? "" : "s"}${subnotes}. Say yes to confirm.`;
}

/** The text spoken to the user: the model's reply, unless the server must correct it. */
export function composeReply(
  modelReply: string,
  changes: AssistantChange[],
  problems: string[],
  pending: PendingDelete | null,
): string {
  const parts: string[] = [];
  if (pending || problems.length > 0) {
    // The model wrote its reply before anything ran, so describe what actually happened.
    if (changes.length > 0) parts.push(`I ${summarize(changes)}.`);
    if (problems.length > 0) {
      const shown = problems.slice(0, 3);
      const more = problems.length > 3 ? `, and ${problems.length - 3} more problem${problems.length === 4 ? "" : "s"}` : "";
      const text = `${shown.join("; ")}${more}`;
      parts.push(changes.length > 0 ? `But ${text}.` : `${text[0].toUpperCase()}${text.slice(1)}.`);
    }
    if (pending) parts.push(confirmationQuestion(pending));
    return parts.join(" ");
  }
  return modelReply.trim() || (changes.length > 0 ? `Done, I ${summarize(changes)}.` : "Okay.");
}

/** Short record of what happened, appended to the assistant turn in the history (handles keep follow-ups working). */
export function historyNote(changes: AssistantChange[], pending: PendingDelete | null, handle: (id: string) => string) {
  const items = changes.map(
    (c) => `${VERB[c.kind]} ${handle(c.taskId)} ${JSON.stringify(c.title)}${c.kind === "deleted" ? "" : ` on ${c.date}`}`,
  );
  if (pending) items.push(`waiting for confirmation to delete ${pending.ids.map(handle).join(", ")}`);
  return items.length ? `\n[${items.join("; ")}]` : "";
}
