import "server-only";
import { asc, count, eq, sql } from "drizzle-orm";
import { DEFAULT_PRIORITIES, DEFAULT_STATUSES } from "@/lib/colors";
import { getDb, schema } from "@/lib/db";
import type { Label, LabelKind } from "@/lib/types";
import { HttpError, notFound } from "./http";
import { setSortOrders } from "./sort-order";

const { statuses, priorities, tasks, appMeta } = schema;

const tableFor = (kind: LabelKind) => (kind === "statuses" ? statuses : priorities);
const taskColumnFor = (kind: LabelKind) => (kind === "statuses" ? tasks.statusId : tasks.priorityId);
const nounFor = (kind: LabelKind) => (kind === "statuses" ? "Status" : "Priority");

function toLabel(row: typeof statuses.$inferSelect): Label {
  return { id: row.id, name: row.name, color: row.color, sortOrder: row.sortOrder };
}

let seeded = false;

/**
 * Seeds default statuses and priorities exactly once per database (recorded in
 * app_meta), so deleting all of them later doesn't bring them back.
 */
export async function ensureSeeded(): Promise<void> {
  if (seeded) return;
  await getDb().transaction(async (tx) => {
    const inserted = await tx
      .insert(appMeta)
      .values({ key: "seeded_defaults", value: new Date().toISOString() })
      .onConflictDoNothing()
      .returning({ key: appMeta.key });
    if (inserted.length === 0) return;
    await tx.insert(statuses).values(DEFAULT_STATUSES.map((s, i) => ({ ...s, sortOrder: i })));
    await tx.insert(priorities).values(DEFAULT_PRIORITIES.map((p, i) => ({ ...p, sortOrder: i })));
  });
  seeded = true;
}

export async function listLabels(kind: LabelKind): Promise<Label[]> {
  await ensureSeeded();
  const table = tableFor(kind);
  const rows = await getDb().select().from(table).orderBy(asc(table.sortOrder), asc(table.createdAt));
  return rows.map(toLabel);
}

export async function createLabel(kind: LabelKind, input: { name: string; color: string }): Promise<Label> {
  const table = tableFor(kind);
  const [{ max }] = await getDb()
    .select({ max: sql<number | null>`max(${table.sortOrder})` })
    .from(table);
  const [row] = await getDb()
    .insert(table)
    .values({ ...input, sortOrder: (max ?? -1) + 1 })
    .returning();
  return toLabel(row);
}

export async function updateLabel(
  kind: LabelKind,
  id: string,
  input: { name?: string; color?: string },
): Promise<Label> {
  const table = tableFor(kind);
  const [row] = await getDb()
    .update(table)
    .set({ ...input, updatedAt: new Date() })
    .where(eq(table.id, id))
    .returning();
  if (!row) throw notFound(nounFor(kind));
  return toLabel(row);
}

export async function reorderLabels(kind: LabelKind, orderedIds: string[]): Promise<void> {
  const table = tableFor(kind);
  await getDb().transaction(async (tx) => {
    const existing = await tx.select({ id: table.id }).from(table);
    const known = new Set(existing.map((r) => r.id));
    if (orderedIds.length !== known.size || !orderedIds.every((i) => known.has(i))) {
      throw new HttpError(409, "The list changed in the meantime. Please reload.");
    }
    await setSortOrders(tx, table, orderedIds);
  });
}

/**
 * Deletes a status/priority. If tasks use it, `reassignTo` must say what they
 * get instead: another label's id, or "none". Otherwise responds 409 with the
 * usage count so the client can ask.
 */
export async function deleteLabel(
  kind: LabelKind,
  id: string,
  reassignTo: string | undefined,
): Promise<{ reassigned: number }> {
  const table = tableFor(kind);
  const column = taskColumnFor(kind);
  return getDb().transaction(async (tx) => {
    const [existing] = await tx.select({ id: table.id }).from(table).where(eq(table.id, id));
    if (!existing) throw notFound(nounFor(kind));

    const [{ value: inUse }] = await tx.select({ value: count() }).from(tasks).where(eq(column, id));
    if (inUse > 0 && reassignTo === undefined) {
      throw new HttpError(409, `${nounFor(kind)} is used by ${inUse} task(s).`, { inUse });
    }

    let target: string | null = null;
    if (reassignTo && reassignTo !== "none") {
      if (reassignTo === id) throw new HttpError(400, "Pick a different one to reassign to.");
      const [found] = await tx.select({ id: table.id }).from(table).where(eq(table.id, reassignTo));
      if (!found) throw notFound(nounFor(kind));
      target = reassignTo;
    }

    if (inUse > 0) {
      const field = kind === "statuses" ? { statusId: target } : { priorityId: target };
      await tx.update(tasks).set(field).where(eq(column, id));
    }
    await tx.delete(table).where(eq(table.id, id));
    return { reassigned: inUse };
  });
}
