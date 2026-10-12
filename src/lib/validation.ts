import { z } from "zod";
import { HEX_COLOR_RE } from "./colors";
import { isISODate } from "./dates";

export const isoDate = z.string().refine(isISODate, "Expected a date in YYYY-MM-DD format.");
export const id = z.uuid();
export const title = z.string().trim().min(1, "Title can't be empty.").max(500);
export const description = z.string().trim().max(5000).nullable().transform((v) => v || null);
export const labelName = z.string().trim().min(1, "Name can't be empty.").max(40);
export const color = z.string().regex(HEX_COLOR_RE, "Expected a hex color like #FF9500.");
export const labelKind = z.enum(["statuses", "priorities"]);

export const createTaskInput = z.object({
  date: isoDate,
  title,
  parentId: id.nullish(),
  description: description.optional(),
  statusId: id.nullish(),
  priorityId: id.nullish(),
});

export const updateTaskInput = z
  .object({
    title: title.optional(),
    description: description.optional(),
    statusId: id.nullable().optional(),
    priorityId: id.nullable().optional(),
    date: isoDate.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update.");

export const dateRangeQuery = z
  .object({ from: isoDate, to: isoDate })
  .refine((v) => v.from <= v.to, "`from` must not be after `to`.");

export const reorderTasksInput = z.object({
  parentId: id.nullable(),
  date: isoDate,
  orderedIds: z.array(id).min(1).max(1000),
});

export const createLabelInput = z.object({ name: labelName, color });
export const updateLabelInput = z
  .object({ name: labelName.optional(), color: color.optional() })
  .refine((v) => v.name !== undefined || v.color !== undefined, "Nothing to update.");
export const reorderLabelsInput = z.object({ orderedIds: z.array(id).min(1).max(200) });
export const deleteLabelQuery = z.object({
  /** Omitted → fail with 409 if in use; "none" → clear; otherwise a label id. */
  reassignTo: z.union([z.literal("none"), id]).optional(),
});

export const loginInput = z.object({ password: z.string().min(1).max(500) });
