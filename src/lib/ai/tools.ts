import "server-only";
import { z } from "zod";
import { differenceInCalendarDays } from "date-fns";
import { fromISODate } from "@/lib/dates";
import { DepthLimitError } from "@/lib/depth";
import { HttpError } from "@/lib/server/http";
import { listLabels } from "@/lib/server/labels";
import { createTask, deleteTask, getTask, listTasks, searchTasks, subtreeSize, updateTask } from "@/lib/server/tasks";
import type { AssistantChange, Label, Task, TaskPatch } from "@/lib/types";
import { description, id, isoDate, title } from "@/lib/validation";

/** JSON-schema tool definitions (OpenAI-compatible) sent to Groq. */
export const TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "list_tasks",
      description:
        "List tasks between two dates (inclusive). Returns each task with id, date, title, status, priority, parent_id and depth.",
      parameters: {
        type: "object",
        properties: {
          from_date: { type: "string", description: "Start date, YYYY-MM-DD" },
          to_date: { type: "string", description: "End date, YYYY-MM-DD (max 366 days after from_date)" },
          include_subtasks: { type: "boolean", description: "Include sub-notes (default true)" },
        },
        required: ["from_date", "to_date"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_tasks",
      description: "Find tasks whose title or description contains the text (case-insensitive). Newest dates first.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_task",
      description:
        "Create a task on a day, or a sub-note under parent_id (sub-notes always share the parent's date; at most 3 levels below a top-level task).",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "YYYY-MM-DD" },
          title: { type: "string" },
          parent_id: { type: "string", description: "Id of the parent task for a sub-note" },
          priority: { type: "string", description: "Priority name from list_priorities" },
          status: { type: "string", description: "Status name from list_statuses (default: the first status)" },
          description: { type: "string" },
        },
        required: ["date", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_task",
      description:
        "Change a task. Setting date moves it (with its sub-notes) to that day; moving a sub-note makes it a top-level task. Use null for priority/status/description to clear them.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          date: { type: "string", description: "New date YYYY-MM-DD" },
          priority: { type: ["string", "null"], description: "Priority name, or null to clear" },
          status: { type: ["string", "null"], description: "Status name, or null to clear" },
          description: { type: ["string", "null"] },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_task",
      description:
        "Delete a task and all its sub-notes. If this would delete more than one task in total, first ask the user and only call with confirmed=true after they confirmed in their latest message.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          confirmed: { type: "boolean", description: "True only if the user explicitly confirmed this deletion" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_priorities",
      description: "List the available priorities, in order.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_statuses",
      description: "List the available statuses, in order.",
      parameters: { type: "object", properties: {} },
    },
  },
] as const;

const schemas = {
  list_tasks: z.object({
    from_date: isoDate,
    to_date: isoDate,
    include_subtasks: z.boolean().optional().default(true),
  }),
  search_tasks: z.object({ query: z.string().trim().min(1).max(200) }),
  create_task: z.object({
    date: isoDate,
    title,
    parent_id: id.nullish(),
    priority: z.string().nullish(),
    status: z.string().nullish(),
    description: description.optional(),
  }),
  update_task: z.object({
    id,
    title: title.optional(),
    date: isoDate.optional(),
    priority: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    description: description.optional(),
  }),
  delete_task: z.object({ id, confirmed: z.boolean().optional() }),
  list_priorities: z.object({}).passthrough(),
  list_statuses: z.object({}).passthrough(),
};

type ToolName = keyof typeof schemas;

/** Per-request state shared by all tool calls of one assistant turn. */
export interface ToolContext {
  changes: AssistantChange[];
  deletesThisTurn: number;
  /** delete_task calls in the model response currently being executed. */
  deleteCallsInBatch: number;
  /** Whether a previous assistant message exists that could have asked for confirmation. */
  canConfirm: boolean;
  labels?: { statuses: Label[]; priorities: Label[] };
}

class ToolInputError extends Error {}

export async function labels(ctx: ToolContext) {
  ctx.labels ??= {
    statuses: await listLabels("statuses"),
    priorities: await listLabels("priorities"),
  };
  return ctx.labels;
}

/** Resolves a label by (case-insensitive) name or id. undefined = not given, null = clear. */
async function resolveLabel(
  ctx: ToolContext,
  kind: "statuses" | "priorities",
  value: string | null | undefined,
): Promise<string | null | undefined> {
  if (value === undefined) return undefined;
  if (value === null || /^(none|no (status|priority))$/i.test(value.trim())) return null;
  const list = (await labels(ctx))[kind];
  const wanted = value.trim().toLowerCase();
  const match = list.find((l) => l.id === value || l.name.toLowerCase() === wanted);
  if (!match) {
    const names = list.map((l) => l.name).join(", ") || "(none defined)";
    throw new ToolInputError(`Unknown ${kind === "statuses" ? "status" : "priority"} "${value}". Available: ${names}.`);
  }
  return match.id;
}

async function describeTasks(ctx: ToolContext, tasks: Task[]) {
  const { statuses, priorities } = await labels(ctx);
  const name = (list: Label[], labelId: string | null) => list.find((l) => l.id === labelId)?.name ?? null;
  return tasks.map((t) => ({
    id: t.id,
    date: t.date,
    title: t.title,
    status: name(statuses, t.statusId),
    priority: name(priorities, t.priorityId),
    parent_id: t.parentId,
    depth: t.depth,
    ...(t.description ? { description: t.description.slice(0, 300) } : {}),
  }));
}

const MAX_LISTED = 200;

async function run(name: ToolName, rawArgs: unknown, ctx: ToolContext): Promise<unknown> {
  switch (name) {
    case "list_tasks": {
      const args = schemas.list_tasks.parse(rawArgs);
      if (args.from_date > args.to_date) throw new ToolInputError("from_date must not be after to_date.");
      if (differenceInCalendarDays(fromISODate(args.to_date), fromISODate(args.from_date)) > 366) {
        throw new ToolInputError("Date range too large; use at most 366 days.");
      }
      let tasks = await listTasks(args.from_date, args.to_date);
      if (!args.include_subtasks) tasks = tasks.filter((t) => t.parentId === null);
      const truncated = tasks.length > MAX_LISTED;
      return { tasks: await describeTasks(ctx, tasks.slice(0, MAX_LISTED)), ...(truncated ? { truncated: true } : {}) };
    }
    case "search_tasks": {
      const { query } = schemas.search_tasks.parse(rawArgs);
      return { tasks: await describeTasks(ctx, await searchTasks(query, 30)) };
    }
    case "list_priorities":
      return { priorities: (await labels(ctx)).priorities.map((l) => l.name) };
    case "list_statuses":
      return { statuses: (await labels(ctx)).statuses.map((l) => l.name) };
    case "create_task": {
      const args = schemas.create_task.parse(rawArgs);
      const task = await createTask({
        date: args.date,
        title: args.title,
        parentId: args.parent_id ?? null,
        description: args.description ?? null,
        statusId: await resolveLabel(ctx, "statuses", args.status ?? undefined),
        priorityId: (await resolveLabel(ctx, "priorities", args.priority ?? undefined)) ?? null,
      });
      ctx.changes.push({ kind: "created", taskId: task.id, title: task.title, date: task.date });
      return { created: (await describeTasks(ctx, [task]))[0] };
    }
    case "update_task": {
      const args = schemas.update_task.parse(rawArgs);
      const patch: TaskPatch = {};
      if (args.title !== undefined) patch.title = args.title;
      if (args.date !== undefined) patch.date = args.date;
      if (args.description !== undefined) patch.description = args.description;
      const statusId = await resolveLabel(ctx, "statuses", args.status);
      if (statusId !== undefined) patch.statusId = statusId;
      const priorityId = await resolveLabel(ctx, "priorities", args.priority);
      if (priorityId !== undefined) patch.priorityId = priorityId;
      if (Object.keys(patch).length === 0) throw new ToolInputError("No fields to update were given.");

      const before = await getTask(args.id);
      if (!before) throw new ToolInputError(`No task with id ${args.id}.`);
      const { task } = await updateTask(args.id, patch);
      const moved = task.date !== before.date;
      ctx.changes.push({ kind: moved ? "moved" : "updated", taskId: task.id, title: task.title, date: task.date });
      return { updated: (await describeTasks(ctx, [task]))[0] };
    }
    case "delete_task": {
      const args = schemas.delete_task.parse(rawArgs);
      const task = await getTask(args.id);
      if (!task) throw new ToolInputError(`No task with id ${args.id}.`);
      const size = await subtreeSize(args.id);
      const multiple = size > 1 || ctx.deleteCallsInBatch > 1 || ctx.deletesThisTurn >= 1;
      const confirmed = args.confirmed === true && ctx.canConfirm;
      if (multiple && !confirmed) {
        return {
          error: "confirmation_required",
          message:
            "Deleting more than one task needs the user's confirmation. Do not delete anything yet: " +
            "tell the user exactly what would be deleted (including sub-notes) and ask them to confirm.",
          task: task.title,
          tasks_including_subnotes: size,
        };
      }
      const { deletedIds } = await deleteTask(args.id);
      ctx.deletesThisTurn += 1;
      ctx.changes.push({ kind: "deleted", taskId: task.id, title: task.title, date: task.date, count: deletedIds.length });
      return { deleted: task.title, tasks_removed: deletedIds.length };
    }
  }
}

/** Executes one tool call; errors are returned to the model as data so it can recover. */
export async function executeTool(name: string, rawArguments: string, ctx: ToolContext): Promise<string> {
  if (!(name in schemas)) return JSON.stringify({ error: `Unknown tool ${name}.` });
  let args: unknown;
  try {
    args = rawArguments ? JSON.parse(rawArguments) : {};
  } catch {
    return JSON.stringify({ error: "Arguments were not valid JSON." });
  }
  try {
    return JSON.stringify(await run(name as ToolName, args, ctx));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return JSON.stringify({ error: "Invalid arguments.", details: z.flattenError(error).fieldErrors });
    }
    if (error instanceof ToolInputError) return JSON.stringify({ error: error.message });
    if (error instanceof DepthLimitError) return JSON.stringify({ error: error.message });
    if (error instanceof HttpError && error.status < 500) return JSON.stringify({ error: error.message });
    console.error(`[assistant] tool ${name} failed:`, error);
    return JSON.stringify({ error: "The operation failed on the server." });
  }
}
