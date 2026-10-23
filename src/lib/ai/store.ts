import "server-only";
import { and, count, eq, gt, inArray, isNull, like, lt, or, sql } from "drizzle-orm";
import { differenceInCalendarDays } from "date-fns";
import { fromISODate, isISODate } from "@/lib/dates";
import { getDb, schema } from "@/lib/db";
import { ensureSeeded } from "@/lib/server/labels";
import {
  createTaskTx,
  deleteTaskTx,
  getTask,
  listTasks,
  searchTasks,
  subtreeIds,
  toTask,
  updateTaskTx,
} from "@/lib/server/tasks";
import type { AssistantChange, Label, Task } from "@/lib/types";
import type { DateRange } from "./date-refs";
import type { KnownTask, Plan } from "./plan";
import { renderSnapshot, renderTasksByDate, selectOutside, SNAPSHOT_CAP, snapshotWindow } from "./snapshot";

/** Database side of the assistant: what the model sees, and applying its plan. */

const { tasks } = schema;
type Labels = { statuses: Label[]; priorities: Label[] };

export async function loadSnapshot(today: string, labels: Labels): Promise<string> {
  const db = getDb();
  const window = snapshotWindow(today);
  const outsideFilter = and(isNull(tasks.parentId), or(lt(tasks.date, window.from), gt(tasks.date, window.to)));

  const [windowTasks, candidateRows, [{ total }]] = await Promise.all([
    listTasks(window.from, window.to),
    db
      .select()
      .from(tasks)
      .where(outsideFilter)
      .orderBy(sql`abs(${tasks.date} - ${today}::date)`, sql`${tasks.date} desc`)
      .limit(SNAPSHOT_CAP),
    db.select({ total: count() }).from(tasks).where(outsideFilter),
  ]);

  const outside = selectOutside(candidateRows.map(toTask), windowTasks.length, today);
  const parents = outside.length
    ? await db
        .selectDistinct({ id: tasks.parentId })
        .from(tasks)
        .where(
          inArray(
            tasks.parentId,
            outside.map((t) => t.id),
          ),
        )
    : [];

  return renderSnapshot({
    today,
    windowTasks,
    outside,
    outsideTotal: total,
    hasSubnotes: new Set(parents.map((p) => p.id!)),
    ...labels,
  });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HANDLE_RE = /^[0-9a-f]{4,8}$/;

/** Resolves the handles the model used to tasks. Unknown or ambiguous handles are left out. */
export async function resolveHandles(handles: string[]): Promise<Map<string, KnownTask>> {
  const known = new Map<string, KnownTask>();
  if (handles.length === 0) return known;
  await getDb().transaction(async (tx) => {
    for (const handle of handles) {
      const where = UUID_RE.test(handle)
        ? eq(tasks.id, handle)
        : HANDLE_RE.test(handle)
          ? like(sql`${tasks.id}::text`, `${handle}%`)
          : null;
      if (!where) continue;
      const rows = await tx.select().from(tasks).where(where).limit(2);
      if (rows.length !== 1) continue; // missing or ambiguous
      const row = rows[0];
      known.set(handle, {
        id: row.id,
        title: row.title,
        date: row.date,
        depth: row.depth,
        subtreeIds: await subtreeIds(tx, row.id),
      });
    }
  });
  return known;
}

const MAX_CONTEXT_TASKS = 150;

/** Keeps a large result readable: all tasks if they fit, otherwise top-level tasks only. */
function fitForContext(found: Task[]): { tasks: Task[]; note: string } {
  if (found.length <= MAX_CONTEXT_TASKS) return { tasks: found, note: "" };
  const tasks = found.filter((t) => t.parentId === null).slice(0, MAX_CONTEXT_TASKS);
  return { tasks, note: `\n(${found.length} tasks in total; showing ${tasks.length} top-level tasks only)` };
}

/**
 * Complete task lists for the months the user mentioned, rendered for the
 * prompt. Saves the model a lookup round-trip for "What did I do in June?".
 */
export async function loadRanges(
  ranges: DateRange[],
  today: string,
  labels: Labels,
): Promise<{ text: string; tasks: Task[] }> {
  const sections: string[] = [];
  const all: Task[] = [];
  for (const range of ranges) {
    const { tasks: found, note } = fitForContext(await listTasks(range.from, range.to));
    all.push(...found);
    const lines = renderTasksByDate(found, today, labels);
    sections.push(
      `${range.label} (${range.from} – ${range.to}):\n${lines.length ? lines.join("\n") : "(no tasks)"}${note}`,
    );
  }
  return { text: sections.join("\n\n"), tasks: all };
}

/** Tasks matching the model's lookup (a text query and/or a date range), rendered like the snapshot. */
export async function lookupTasks(
  lookup: { query?: string; from?: string; to?: string },
  today: string,
  labels: Labels,
): Promise<{ text: string; tasks: Task[] }> {
  let found: Task[] = [];
  const from = lookup.from && isISODate(lookup.from) ? lookup.from : undefined;
  const to = lookup.to && isISODate(lookup.to) ? lookup.to : undefined;
  if (from || to) {
    const start = from ?? to!;
    let end = to ?? from!;
    if (end < start) end = start;
    if (differenceInCalendarDays(fromISODate(end), fromISODate(start)) > 366) end = start;
    found = await listTasks(start, end);
    if (lookup.query) {
      const q = lookup.query.toLowerCase();
      found = found.filter((t) => `${t.title} ${t.description ?? ""}`.toLowerCase().includes(q));
    }
  } else if (lookup.query) {
    found = await searchTasks(lookup.query, 40);
  }
  const { tasks, note } = fitForContext(found);
  const lines = renderTasksByDate(tasks, today, labels);
  return { text: lines.length ? lines.join("\n") + note : "(nothing found)", tasks };
}

/**
 * Applies a plan in ONE transaction: if anything fails, nothing is changed.
 * Deletes listed in `holdDeleteIds` are skipped: they wait for the user's confirmation.
 */
export async function executePlan(
  plan: Plan,
  options: { holdDeleteIds: ReadonlySet<string> },
): Promise<AssistantChange[]> {
  if (plan.creates.length + plan.updates.length + plan.deletes.length === 0) return [];
  await ensureSeeded();
  return getDb().transaction(async (tx) => {
    const changes: AssistantChange[] = [];
    const created = new Map<string, Task>();

    for (const step of plan.creates) {
      const newParent = step.parent?.kind === "new" ? created.get(step.parent.key) : undefined;
      const parentId = step.parent?.kind === "existing" ? step.parent.id : (newParent?.id ?? null);
      const task = await createTaskTx(tx, {
        date: step.date ?? newParent?.date ?? "",
        title: step.title,
        parentId,
        description: step.description,
        statusId: step.statusId,
        priorityId: step.priorityId,
      });
      created.set(step.key, task);
      changes.push({ kind: "created", taskId: task.id, title: task.title, date: task.date });
    }

    for (const step of plan.updates) {
      const { task } = await updateTaskTx(tx, step.id, step.patch);
      const kind = task.date !== step.fromDate ? "moved" : "updated";
      changes.push({ kind, taskId: task.id, title: task.title, date: task.date });
    }

    for (const step of plan.deletes) {
      if (options.holdDeleteIds.has(step.id)) continue;
      const { task, deletedIds } = await deleteTaskTx(tx, step.id);
      changes.push({ kind: "deleted", taskId: task.id, title: task.title, date: task.date, count: deletedIds.length });
    }
    return changes;
  });
}

/** Runs deletes the user confirmed. Tasks that are already gone are skipped. */
export async function deleteConfirmed(ids: string[]): Promise<AssistantChange[]> {
  return getDb().transaction(async (tx) => {
    const changes: AssistantChange[] = [];
    for (const id of ids) {
      if (!(await getTask(id, tx))) continue;
      const { task, deletedIds } = await deleteTaskTx(tx, id);
      changes.push({ kind: "deleted", taskId: task.id, title: task.title, date: task.date, count: deletedIds.length });
    }
    return changes;
  });
}
