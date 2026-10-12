import { addDaysISO, dayLabel, weekStartOf } from "@/lib/dates";
import { childrenOf } from "@/lib/task-tree";
import type { Label, Task } from "@/lib/types";

/**
 * The compact task list sent to the model with every request, so it can answer
 * questions and reference existing tasks without extra round-trips.
 *
 * - Always: every task (including sub-notes) from last week, this week and next week.
 * - Then, up to SNAPSHOT_CAP lines in total: top-level tasks outside that window,
 *   nearest to today first (their sub-notes are not listed).
 */
export const SNAPSHOT_CAP = 150;

/** Short, stable handle the model uses to refer to a task (first 6 hex chars of its id). */
export const handleOf = (id: string) => id.slice(0, 6).toLowerCase();

/** Monday of last week → Sunday of next week. */
export function snapshotWindow(today: string): { from: string; to: string } {
  const thisMonday = weekStartOf(today);
  return { from: addDaysISO(thisMonday, -7), to: addDaysISO(thisMonday, 13) };
}

function dayDistance(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

/** Picks the outside-window top-level tasks that fit the remaining budget, nearest to today first. */
export function selectOutside(candidates: Task[], windowCount: number, today: string, cap = SNAPSHOT_CAP): Task[] {
  const budget = Math.max(0, cap - windowCount);
  return [...candidates]
    .filter((t) => t.parentId === null)
    .sort((a, b) => dayDistance(a.date, today) - dayDistance(b.date, today) || b.date.localeCompare(a.date))
    .slice(0, budget);
}

export interface SnapshotInput {
  today: string;
  /** All tasks (with sub-notes) in the 3-week window. */
  windowTasks: Task[];
  /** Selected top-level tasks outside the window. */
  outside: Task[];
  /** How many top-level tasks exist outside the window in total. */
  outsideTotal: number;
  /** Ids of outside tasks that have sub-notes (which aren't listed). */
  hasSubnotes: Set<string>;
  statuses: Label[];
  priorities: Label[];
}

type LabelLists = Pick<SnapshotInput, "statuses" | "priorities">;

function taskLine(t: Task, indent: number, labels: LabelLists, note = ""): string {
  const name = (list: Label[], id: string | null) => list.find((l) => l.id === id)?.name;
  const tags = [name(labels.statuses, t.statusId), name(labels.priorities, t.priorityId)].filter(Boolean);
  const details = t.description ? ` — ${JSON.stringify(t.description.replace(/\s+/g, " ").slice(0, 60))}` : "";
  return `${"  ".repeat(indent)}${handleOf(t.id)} ${JSON.stringify(t.title)}${tags.length ? ` [${tags.join(", ")}]` : ""}${details}${note}`;
}

/** "MON 2026-10-12": ISO dates, the same format the operations use. */
const isoDay = (date: string) => `${dayLabel(date).slice(0, 3)} ${date}`;
const dayHeader = (date: string, today: string) => `${isoDay(date)}${date === today ? " (today)" : ""}`;

/**
 * Tasks grouped by day; sub-notes indented under their parent. A sub-note whose
 * parent isn't in the list is shown at the top level and marked as a sub-note.
 */
export function renderTasksByDate(
  tasks: Task[],
  today: string,
  labels: LabelLists,
  note: (t: Task) => string = () => "",
): string[] {
  const lines: string[] = [];
  const ids = new Set(tasks.map((t) => t.id));
  const byDate = new Map<string, Task[]>();
  for (const t of tasks) byDate.set(t.date, [...(byDate.get(t.date) ?? []), t]);
  for (const date of [...byDate.keys()].sort()) {
    lines.push(dayHeader(date, today));
    const list = byDate.get(date)!;
    const walk = (parentId: string | null, indent: number) => {
      for (const t of childrenOf(list, parentId)) {
        lines.push(taskLine(t, indent, labels, note(t)));
        walk(t.id, indent + 1);
      }
    };
    walk(null, 1);
    for (const orphan of list.filter((t) => t.parentId && !ids.has(t.parentId))) {
      lines.push(taskLine(orphan, 1, labels, ` (sub-note of ${handleOf(orphan.parentId!)})`));
      walk(orphan.id, 2);
    }
  }
  return lines;
}

export function renderSnapshot(input: SnapshotInput): string {
  const { today } = input;
  const window = snapshotWindow(today);
  const lines: string[] = [
    `Last week, this week and next week (${isoDay(window.from)} – ${isoDay(window.to)}), all tasks; sub-notes are indented under their parent:`,
  ];
  const windowLines = renderTasksByDate(input.windowTasks, today, input);
  lines.push(...(windowLines.length ? windowLines : ["(no tasks)"]));

  if (input.outsideTotal > 0) {
    lines.push("", "Other dates, top-level tasks only (sub-notes not listed):");
    lines.push(...renderTasksByDate(input.outside, today, input, (t) => (input.hasSubnotes.has(t.id) ? " (has sub-notes)" : "")));
    const missing = input.outsideTotal - input.outside.length;
    if (missing > 0) {
      lines.push(`…and ${missing} more top-level task${missing === 1 ? "" : "s"} on other dates, not listed (use lookup).`);
    }
  }
  return lines.join("\n");
}
