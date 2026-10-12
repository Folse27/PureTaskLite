"use client";

import { FIRST_YEAR, treePositionOf, visibleYears } from "@/lib/dates";
import { findTask, usePlanner } from "./planner-store";
import { dayKey, monthKey, taskKey, useUi, weekKey, yearKey } from "./ui-store";

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function nodeElement(key: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-node-key="${CSS.escape(key)}"]`);
}

/**
 * Scrolls a node into view. Expanding ancestors animate their height, so the
 * target can still shift after the first scroll; correct once they've settled.
 */
async function scrollToNode(key: string) {
  for (let i = 0; i < 10 && !nodeElement(key); i++) await nextFrame();
  const el = nodeElement(key);
  if (!el) return;
  const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";
  el.scrollIntoView({ behavior, block: "start" });
  setTimeout(() => {
    const top = el.getBoundingClientRect().top;
    const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
    if (Math.abs(top - margin) > 8) el.scrollIntoView({ behavior, block: "start" });
  }, 450);
  el.focus({ preventScroll: true });
  useUi.getState().setActive(key);
}

/** Expands the path to a date (year → month → week [→ day]) and loads that week's tasks. */
async function expandTo(date: string, includeDay: boolean, today: string) {
  const { year, monthIndex, week } = treePositionOf(date);
  if (year < FIRST_YEAR) return null;
  const ui = useUi.getState();
  const lastDefault = visibleYears(today).at(-1)!;
  if (year > lastDefault) ui.ensureYearVisible(year - lastDefault);
  ui.expandMany([
    yearKey(year),
    monthKey(year, monthIndex),
    weekKey(week),
    ...(includeDay ? [dayKey(date)] : []),
  ]);
  await usePlanner.getState().loadWeek(week);
  return week;
}

/** "Today" button: open the current week (and today), scroll to it and flash it. */
export async function revealToday(today: string) {
  const week = await expandTo(today, true, today);
  if (!week) return;
  await nextFrame();
  await scrollToNode(weekKey(week));
  useUi.getState().flashNode(weekKey(week));
}

/** Assistant change links: open the task's day, scroll to the task and flash it. */
export async function revealTask(taskId: string, date: string, today: string) {
  await expandTo(date, true, today);
  // Expand collapsed ancestors of a sub-note.
  const state = usePlanner.getState();
  let task = findTask(state, taskId);
  const ui = useUi.getState();
  while (task?.parentId) {
    ui.setTaskExpanded(task.parentId, true);
    task = findTask(state, task.parentId);
  }
  await nextFrame();
  const key = findTask(state, taskId) ? taskKey(taskId) : dayKey(date);
  await scrollToNode(key);
  useUi.getState().flashNode(key);
}
