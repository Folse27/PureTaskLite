import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/*
 * Every table has Row Level Security enabled with no policies. The app connects
 * as the table owner (which bypasses RLS), while Supabase's public REST/GraphQL
 * API (anon / authenticated roles) can neither read nor write anything.
 */

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

const labelColumns = {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  color: text("color").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  ...timestamps,
};

export const statuses = pgTable("statuses", labelColumns).enableRLS();
export const priorities = pgTable("priorities", labelColumns).enableRLS();

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Calendar day (Europe/Berlin) the task belongs to. Sub-notes share their root's date. */
    date: date("date", { mode: "string" }).notNull(),
    parentId: uuid("parent_id").references((): AnyPgColumn => tasks.id, { onDelete: "cascade" }),
    /** 0 = top-level task, 1–3 = sub-note levels. */
    depth: smallint("depth").notNull().default(0),
    title: text("title").notNull(),
    description: text("description"),
    statusId: uuid("status_id").references(() => statuses.id, { onDelete: "set null" }),
    priorityId: uuid("priority_id").references(() => priorities.id, { onDelete: "set null" }),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (t) => [
    index("tasks_date_idx").on(t.date),
    index("tasks_parent_idx").on(t.parentId),
    check("tasks_depth_check", sql`${t.depth} between 0 and 3`),
    check("tasks_parent_depth_check", sql`(${t.parentId} is null) = (${t.depth} = 0)`),
  ],
).enableRLS();

/** Failed login attempts (hashed IPs only). */
export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    ipHash: text("ip_hash").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("login_attempts_ip_time_idx").on(t.ipHash, t.attemptedAt),
    index("login_attempts_time_idx").on(t.attemptedAt),
  ],
).enableRLS();

/** Active/previous lockouts, keyed by "ip:<hash>" or "global". */
export const loginLockouts = pgTable("login_lockouts", {
  key: text("key").primaryKey(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }).notNull(),
  level: integer("level").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

/** Small key/value table, e.g. to remember that defaults were seeded. */
export const appMeta = pgTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export type TaskRow = typeof tasks.$inferSelect;
export type LabelRow = typeof statuses.$inferSelect;
