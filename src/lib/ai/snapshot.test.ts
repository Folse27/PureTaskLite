import { describe, expect, it } from "vitest";
import type { Label, Task } from "@/lib/types";
import { handleOf, renderSnapshot, selectOutside, snapshotWindow } from "./snapshot";

const TODAY = "2026-10-12"; // Monday
const statuses: Label[] = [{ id: "s1", name: "To do", color: "#8E8E93", sortOrder: 0 }];
const priorities: Label[] = [{ id: "p1", name: "Urgent", color: "#FF3B30", sortOrder: 0 }];

let n = 0;
function task(date: string, title: string, parentId: string | null = null, extra: Partial<Task> = {}): Task {
  const id = `${(++n).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
  return {
    id,
    date,
    parentId,
    depth: parentId ? 1 : 0,
    title,
    description: null,
    statusId: "s1",
    priorityId: null,
    sortOrder: n,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    ...extra,
  };
}

describe("snapshotWindow", () => {
  it("spans Monday of last week to Sunday of next week", () => {
    expect(snapshotWindow(TODAY)).toEqual({ from: "2026-10-05", to: "2026-10-25" });
    expect(snapshotWindow("2026-10-18")).toEqual({ from: "2026-10-05", to: "2026-10-25" }); // Sunday
  });
});

describe("selectOutside", () => {
  const far = [
    task("2026-12-24", "Christmas shopping"),
    task("2026-09-30", "Old task"),
    task("2026-11-02", "Dentist"),
    task("2027-03-01", "Taxes"),
  ];

  it("fills the remaining budget with the tasks nearest to today", () => {
    expect(selectOutside(far, 148, TODAY, 150).map((t) => t.title)).toEqual(["Old task", "Dentist"]);
  });

  it("adds none when the 3-week window already uses the whole budget", () => {
    expect(selectOutside(far, 150, TODAY, 150)).toEqual([]);
    expect(selectOutside(far, 400, TODAY, 150)).toEqual([]);
  });

  it("never includes sub-notes from outside the window", () => {
    const sub = task("2026-11-03", "Sub", far[2].id);
    expect(selectOutside([...far, sub], 0, TODAY).map((t) => t.title)).not.toContain("Sub");
  });
});

describe("renderSnapshot", () => {
  const root = task(TODAY, "Finish portfolio website", null, { priorityId: "p1" });
  const sub = task(TODAY, "Create thumbnails", root.id);
  const outside = task("2026-11-02", "Dentist");

  const text = renderSnapshot({
    today: TODAY,
    windowTasks: [root, sub, task("2026-10-16", 'Gym "leg day"', null, { description: "Bring\nshoes" })],
    outside: [outside],
    outsideTotal: 5,
    hasSubnotes: new Set([outside.id]),
    statuses,
    priorities,
  });

  it("lists window tasks with handles, labels and indented sub-notes", () => {
    expect(text).toContain("MON 2026-10-12 (today)");
    expect(text).toContain("(MON 2026-10-05 – SUN 2026-10-25)");
    expect(text).toContain(`  ${handleOf(root.id)} "Finish portfolio website" [To do, Urgent]`);
    expect(text).toContain(`    ${handleOf(sub.id)} "Create thumbnails" [To do]`);
    expect(text).toContain(`"Gym \\"leg day\\"" [To do] — "Bring shoes"`);
  });

  it("lists outside tasks top-level only and says how many were left out", () => {
    expect(text).toContain("Other dates, top-level tasks only");
    expect(text).toContain(`${handleOf(outside.id)} "Dentist" [To do] (has sub-notes)`);
    expect(text).toContain("…and 4 more top-level tasks on other dates, not listed (use lookup).");
  });

  it("uses 6-character handles", () => {
    expect(handleOf(root.id)).toHaveLength(6);
  });
});
