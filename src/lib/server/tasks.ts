import "server-only";
import { and, asc, eq, gte, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { childDepth } from "@/lib/depth";
import { getDb, schema, type Transaction } from "@/lib/db";
import type { Task, TaskPatch } from "@/lib/types";
import { HttpError, notFound } from "./http";
import { ensureSeeded } from "./labels";

const { tasks, statuses } = schema;

type Row = typeof tasks.$inferSelect;

export function toTask(row: Row): Task {
  return {
    id: row.id,
    date: row.date,
    parentId: row.parentId,
    depth: row.depth,
    title: row.title,
    description: row.description,
    statusId: row.statusId,
    priorityId: row.priorityId,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const ordering = [asc(tasks.date), asc(tasks.depth), asc(tasks.sortOrder), asc(tasks.createdAt)];

export async function listTasks(from: string, to: string): Promise<Task[]> {
  const rows = await getDb()
    .select()
    .from(tasks)
    .where(and(gte(tasks.date, from), lte(tasks.date, to)))
    .orderBy(...ordering);
  return rows.map(toTask);
}

/** Number of top-level tasks per day, for the badges on collapsed weeks/days. */
export async function countsByDate(): Promise<Record<string, number>> {
  const rows = await getDb()
    .select({ date: tasks.date, count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(isNull(tasks.parentId))
    .groupBy(tasks.date);
  return Object.fromEntries(rows.map((r) => [r.date, r.count]));
}

export async function getTask(id: string, tx: Transaction | ReturnType<typeof getDb> = getDb()) {
  const [row] = await tx.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  return row ?? null;
}

export async function searchTasks(query: string, limit = 50): Promise<Task[]> {
  const pattern = `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const rows = await getDb()
    .select()
    .from(tasks)
    .where(or(ilike(tasks.title, pattern), ilike(tasks.description, pattern)))
    .orderBy(sql`${tasks.date} desc`, asc(tasks.depth), asc(tasks.sortOrder))
    .limit(limit);
  return rows.map(toTask);
}

async function nextSortOrder(tx: Transaction, date: string, parentId: string | null): Promise<number> {
  const [row] = await tx
    .select({ max: sql<number | null>`max(${tasks.sortOrder})` })
    .from(tasks)
    .where(parentId ? eq(tasks.parentId, parentId) : and(eq(tasks.date, date), isNull(tasks.parentId)));
  return (row?.max ?? -1) + 1;
}

async function defaultStatusId(tx: Transaction): Promise<string | null> {
  const [row] = await tx.select({ id: statuses.id }).from(statuses).orderBy(asc(statuses.sortOrder)).limit(1);
  return row?.id ?? null;
}

export interface CreateTaskInput {
  date: string;
  title: string;
  parentId?: string | null;
  description?: string | null;
  /** undefined → default (first) status; null → no status. */
  statusId?: string | null;
  priorityId?: string | null;
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  await ensureSeeded();
  return getDb().transaction(async (tx) => {
    let date = input.date;
    let depth = 0;
    const parentId = input.parentId ?? null;
    if (parentId) {
      const parent = await getTask(parentId, tx);
      if (!parent) throw notFound("Parent task");
      depth = childDepth(parent.depth); // throws DepthLimitError at max depth
      date = parent.date; // sub-notes always live on their root's day
    }
    const statusId = input.statusId === undefined ? await defaultStatusId(tx) : input.statusId;
    const [row] = await tx
      .insert(tasks)
      .values({
        date,
        parentId,
        depth,
        title: input.title,
        description: input.description ?? null,
        statusId,
        priorityId: input.priorityId ?? null,
        sortOrder: await nextSortOrder(tx, date, parentId),
      })
      .returning();
    return toTask(row);
  });
}

/** Ids of a task and all of its descendants. */
async function subtreeIds(tx: Transaction, id: string): Promise<string[]> {
  const rows = await tx.execute<{ id: string }>(sql`
    with recursive sub as (
      select id from ${tasks} where id = ${id}
      union all
      select t.id from ${tasks} t join sub on t.parent_id = sub.id
    )
    select id from sub`);
  return rows.map((r) => r.id);
}

/**
 * Updates fields. Changing `date` moves the task and all its sub-notes; moving
 * a sub-note to another day turns it into a top-level task on that day.
 */
export async function updateTask(id: string, patch: TaskPatch): Promise<{ task: Task; movedIds: string[] }> {
  return getDb().transaction(async (tx) => {
    const current = await getTask(id, tx);
    if (!current) throw notFound();

    let movedIds: string[] = [];
    if (patch.date !== undefined && patch.date !== current.date) {
      movedIds = await subtreeIds(tx, id);
      const sortOrder = await nextSortOrder(tx, patch.date, null);
      // One statement, so the "top-level ⇔ depth 0" check holds for every row.
      await tx
        .update(tasks)
        .set({
          date: patch.date,
          depth: sql`${tasks.depth} - ${current.depth}`,
          parentId: sql`case when ${tasks.id} = ${id} then null else ${tasks.parentId} end`,
          sortOrder: sql`case when ${tasks.id} = ${id} then ${sortOrder} else ${tasks.sortOrder} end`,
          updatedAt: new Date(),
        })
        .where(inArray(tasks.id, movedIds));
    }

    const fields: Partial<typeof tasks.$inferInsert> = {};
    if (patch.title !== undefined) fields.title = patch.title;
    if (patch.description !== undefined) fields.description = patch.description;
    if (patch.statusId !== undefined) fields.statusId = patch.statusId;
    if (patch.priorityId !== undefined) fields.priorityId = patch.priorityId;

    const [row] = await tx
      .update(tasks)
      .set({ ...fields, updatedAt: new Date() })
      .where(eq(tasks.id, id))
      .returning();
    return { task: toTask(row), movedIds };
  });
}

/** Deletes a task and (via ON DELETE CASCADE) all its sub-notes. */
export async function deleteTask(id: string): Promise<{ task: Task; deletedIds: string[] }> {
  return getDb().transaction(async (tx) => {
    const current = await getTask(id, tx);
    if (!current) throw notFound();
    const deletedIds = await subtreeIds(tx, id);
    await tx.delete(tasks).where(eq(tasks.id, id));
    return { task: toTask(current), deletedIds };
  });
}

/** How many tasks a delete would remove (the task plus its descendants). */
export async function subtreeSize(id: string): Promise<number> {
  return getDb().transaction(async (tx) => (await subtreeIds(tx, id)).length);
}

export async function reorderTasks(date: string, parentId: string | null, orderedIds: string[]): Promise<void> {
  await getDb().transaction(async (tx) => {
    const siblings = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(parentId ? eq(tasks.parentId, parentId) : and(eq(tasks.date, date), isNull(tasks.parentId)));
    const siblingIds = new Set(siblings.map((s) => s.id));
    if (orderedIds.length !== siblingIds.size || !orderedIds.every((i) => siblingIds.has(i))) {
      throw new HttpError(409, "The list changed in the meantime. Please reload.");
    }
    for (const [index, taskId] of orderedIds.entries()) {
      await tx.update(tasks).set({ sortOrder: index }).where(eq(tasks.id, taskId));
    }
  });
}
