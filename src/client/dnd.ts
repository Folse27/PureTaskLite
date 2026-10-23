"use client";

import { useEffect, useMemo, useRef } from "react";
import { create } from "zustand";
import { canAddChild, MAX_DEPTH } from "@/lib/depth";
import { canMoveTo, childrenOf, subtreeIds } from "@/lib/task-tree";
import type { MoveTarget } from "@/lib/task-tree";
import { findTask, usePlanner } from "./planner-store";
import { dayKey, taskKey, useUi } from "./ui-store";

/**
 * Drag and drop for tasks, across sub-note levels and days.
 *
 * - Mouse/trackpad: drag the grip that appears when hovering a task.
 * - Touch: long-press a task, then drag (scrolling still works normally).
 *
 * Drop zones: the upper/lower part of a task row (before/after it, as a
 * sibling), its middle (as its last sub-note), or a day row (end of that day).
 * Rows advertise themselves with data-drop="task" | "day" attributes.
 */

type Point = { x: number; y: number };

export type DropKind = "before" | "after" | "inside" | "day";

export interface DropTarget extends MoveTarget {
  kind: DropKind;
  /** Where to draw the indicator (viewport coordinates). */
  rect: { left: number; top: number; width: number; height: number };
  /** Left edge of the insertion line (the target row's content start). */
  lineLeft: number;
  /** Row key to flash after the drop. */
  rowKey: string;
}

interface DragState {
  active: {
    id: string;
    title: string;
    x: number;
    y: number;
    /** Where the row was grabbed, relative to its top-left corner. */
    offsetX: number;
    offsetY: number;
    width: number;
  } | null;
  target: DropTarget | null;
}

export const useDrag = create<DragState>(() => ({ active: null, target: null }));

const EDGE = 80; // px from the viewport edge where auto-scroll starts
const MAX_SPEED = 18; // px per frame

let cleanup: (() => void) | null = null;
let lastPoint = { x: 0, y: 0 };
let startPoint = { x: 0, y: 0 };
/** Auto-scroll only once the user has actually moved (picking up a task near an edge shouldn't scroll). */
let hasMoved = false;
let scrollFrame = 0;

function findTarget(x: number, y: number, draggedId: string): DropTarget | null {
  const row = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop]");
  if (!row) return null;
  const rect = row.getBoundingClientRect();
  const box = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  const state = usePlanner.getState();

  if (row.dataset.drop === "day") {
    const date = row.dataset.date!;
    const list = state.tasksByDate[date] ?? [];
    const index = childrenOf(list, null).filter((t) => t.id !== draggedId).length;
    return { kind: "day", parentId: null, date, index, rect: box, lineLeft: rect.left, rowKey: dayKey(date) };
  }

  const targetId = row.dataset.taskId!;
  const target = findTask(state, targetId);
  const dragged = findTask(state, draggedId);
  if (!target || !dragged) return null;
  const list = [
    ...(state.tasksByDate[dragged.date] ?? []),
    ...(target.date !== dragged.date ? (state.tasksByDate[target.date] ?? []) : []),
  ];
  if (subtreeIds(list, draggedId).has(targetId)) return null; // onto itself or its own sub-notes

  const rel = (y - rect.top) / rect.height;
  const childrenVisible = row.dataset.childrenVisible === "true";
  let kind: DropKind = rel < 0.3 ? "before" : rel > 0.7 ? "after" : "inside";
  if (kind === "inside" && !canAddChild(target.depth)) kind = rel < 0.5 ? "before" : "after";
  // Dropping "after" a task whose sub-notes are showing visually means "first sub-note".
  const firstChild = kind === "after" && childrenVisible;

  let to: MoveTarget;
  if (kind === "inside" || firstChild) {
    const children = childrenOf(list, target.id).filter((t) => t.id !== draggedId);
    to = { parentId: target.id, date: target.date, index: firstChild ? 0 : children.length };
  } else {
    const siblings = childrenOf(
      list.filter((t) => t.parentId !== null || t.date === target.date),
      target.parentId,
    ).filter((t) => t.id !== draggedId);
    const at = siblings.findIndex((t) => t.id === target.id);
    to = { parentId: target.parentId, date: target.date, index: kind === "after" ? at + 1 : at };
  }
  if (!canMoveTo(list, draggedId, to.parentId, MAX_DEPTH)) return null;

  const content = parseFloat(getComputedStyle(row).paddingLeft) || 0;
  return {
    ...to,
    kind: firstChild ? "inside" : kind,
    rect: box,
    lineLeft: rect.left + content + (firstChild ? 24 : 0),
    rowKey: taskKey(target.id),
  };
}

function update(x: number, y: number) {
  lastPoint = { x, y };
  if (!hasMoved && Math.hypot(x - startPoint.x, y - startPoint.y) > 16) hasMoved = true;
  const { active } = useDrag.getState();
  if (!active) return;
  useDrag.setState({ active: { ...active, x, y }, target: findTarget(x, y, active.id) });
}

function autoScroll() {
  const { y } = lastPoint;
  const bottomEdge = window.innerHeight - EDGE;
  let speed = 0;
  if (hasMoved && y < EDGE) speed = -((EDGE - y) / EDGE) * MAX_SPEED;
  else if (hasMoved && y > bottomEdge) speed = ((y - bottomEdge) / EDGE) * MAX_SPEED;
  if (speed !== 0) {
    window.scrollBy(0, speed);
    update(lastPoint.x, lastPoint.y); // the content moved under the pointer
  }
  scrollFrame = requestAnimationFrame(autoScroll);
}

/** Is this move a no-op (same parent and same position)? */
function isNoOp(id: string, to: MoveTarget): boolean {
  const state = usePlanner.getState();
  const task = findTask(state, id);
  if (!task || task.parentId !== to.parentId || (to.parentId === null && task.date !== to.date)) return false;
  const siblings = childrenOf(
    (state.tasksByDate[task.date] ?? []).filter((t) => t.parentId !== null || t.date === task.date),
    task.parentId,
  );
  return siblings.findIndex((t) => t.id === id) === to.index;
}

function finish(commit: boolean) {
  const { active, target } = useDrag.getState();
  cleanup?.();
  cleanup = null;
  cancelAnimationFrame(scrollFrame);
  document.documentElement.classList.remove("dragging-task");
  useDrag.setState({ active: null, target: null });
  if (!commit || !active || !target) return;
  const to: MoveTarget = { parentId: target.parentId, date: target.date, index: target.index };
  if (isNoOp(active.id, to)) return;
  if (to.parentId) useUi.getState().setTaskExpanded(to.parentId, true);
  void usePlanner.getState().moveTask(active.id, to);
  useUi.getState().flashNode(target.kind === "day" ? target.rowKey : taskKey(active.id));
}

/** Starts dragging a task. `row` is the task's row element; the point is in viewport coordinates. */
export function beginDrag(
  taskId: string,
  title: string,
  row: HTMLElement,
  point: { x: number; y: number },
  input: "mouse" | "touch",
) {
  if (useDrag.getState().active) return;
  const rect = row.getBoundingClientRect();
  lastPoint = startPoint = point;
  hasMoved = false;
  useDrag.setState({
    active: {
      id: taskId,
      title,
      x: point.x,
      y: point.y,
      offsetX: Math.min(point.x - rect.left, 48),
      offsetY: point.y - rect.top,
      width: Math.min(rect.width, 520),
    },
    target: null,
  });
  document.documentElement.classList.add("dragging-task");

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") finish(false);
  };
  window.addEventListener("keydown", onKey);

  if (input === "mouse") {
    const onMove = (e: PointerEvent) => update(e.clientX, e.clientY);
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
    };
  } else {
    // Touch: block scrolling while dragging (must be non-passive), follow the finger.
    const onMove = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];
      if (t) update(t.clientX, t.clientY);
    };
    const onEnd = (e: TouchEvent) => {
      e.preventDefault(); // no synthetic click on whatever is under the finger
      finish(true);
    };
    const onCancel = () => finish(false);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: false });
    window.addEventListener("touchcancel", onCancel);
    cleanup = () => {
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onCancel);
      window.removeEventListener("keydown", onKey);
    };
  }
  scrollFrame = requestAnimationFrame(autoScroll);
}

const LONG_PRESS_MS = 400;
const SLOP_PX = 8;

/**
 * Long-press-to-drag for touch. Returns stable handlers for the row; a quick
 * tap, a scroll, or a double-tap behaves exactly as before.
 */
export function useLongPress(onLongPress: (point: { x: number; y: number }) => void) {
  const callback = useRef(onLongPress);
  useEffect(() => {
    callback.current = onLongPress;
  });
  const state = useRef<{ timer?: ReturnType<typeof setTimeout>; origin: Point; point: Point }>({
    origin: { x: 0, y: 0 },
    point: { x: 0, y: 0 },
  });

  return useMemo(() => {
    const clear = () => {
      clearTimeout(state.current.timer);
      state.current.timer = undefined;
    };
    return {
      onTouchStart: (e: React.TouchEvent) => {
        clear();
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        state.current.origin = state.current.point = { x: t.clientX, y: t.clientY };
        state.current.timer = setTimeout(() => {
          state.current.timer = undefined;
          navigator.vibrate?.(10);
          callback.current(state.current.point);
        }, LONG_PRESS_MS);
      },
      onTouchMove: (e: React.TouchEvent) => {
        const t = e.touches[0];
        if (!t) return;
        const { origin } = state.current;
        state.current.point = { x: t.clientX, y: t.clientY };
        if (Math.hypot(t.clientX - origin.x, t.clientY - origin.y) > SLOP_PX) clear(); // it's a scroll
      },
      onTouchEnd: clear,
      onTouchCancel: clear,
    };
  }, []);
}
