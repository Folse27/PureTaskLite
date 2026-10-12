"use client";

import { Reorder, useDragControls } from "motion/react";
import { memo, useCallback, useMemo, useState } from "react";
import { useDoubleActivate, useFinePointer } from "@/client/hooks";
import { isTempId, usePlanner } from "@/client/planner-store";
import { taskKey, useUi } from "@/client/ui-store";
import { canAddChild } from "@/lib/depth";
import { childrenOf, subtreeIds } from "@/lib/task-tree";
import type { Task } from "@/lib/types";
import { Grip, Plus } from "../icons";
import { Collapsible } from "../ui/Collapsible";
import { confirmAction } from "../ui/ConfirmHost";
import { AddTaskInput, DescriptionEditor, LabelPill, MoveTaskDialog, TaskMenu, TitleEditor } from "./TaskParts";
import { Chevron, FlashOverlay } from "./TreeItem";

const EMPTY: Task[] = [];
/** Left padding for content at a given task depth (depth 0 = top-level task). */
const indentFor = (depth: number) => `calc(var(--tree-indent) * ${depth + 2} + 8px)`;

/** Siblings under one parent; reorderable by drag on mouse/trackpad, via the menu everywhere. */
export function TaskList({ date, parentId, depth }: { date: string; parentId: string | null; depth: number }) {
  const all = usePlanner((s) => s.tasksByDate[date] ?? EMPTY);
  const reorderSiblings = usePlanner((s) => s.reorderSiblings);
  const siblings = useMemo(() => childrenOf(all, parentId), [all, parentId]);
  const ids = useMemo(() => siblings.map((t) => t.id), [siblings]);
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const order = dragOrder ?? ids;
  const byId = useMemo(() => new Map(siblings.map((t) => [t.id, t])), [siblings]);

  const commitDrag = useCallback(() => {
    if (dragOrder && dragOrder.join() !== ids.join() && dragOrder.length === ids.length) {
      void reorderSiblings(date, parentId, dragOrder);
    }
    setDragOrder(null);
  }, [dragOrder, ids, date, parentId, reorderSiblings]);

  if (siblings.length === 0) return null;
  return (
    <Reorder.Group as="ul" role="group" axis="y" values={order} onReorder={setDragOrder}>
      {order.map((id) => {
        const task = byId.get(id);
        return task ? (
          <TaskItem key={id} task={task} siblings={siblings} depth={depth} onDragEnd={commitDrag} />
        ) : null;
      })}
    </Reorder.Group>
  );
}

interface TaskItemProps {
  task: Task;
  siblings: Task[];
  depth: number;
  onDragEnd: () => void;
}

const TaskItem = memo(function TaskItem({ task, siblings, depth, onDragEnd }: TaskItemProps) {
  const key = taskKey(task.id);
  const hasChildren = usePlanner((s) => (s.tasksByDate[task.date] ?? EMPTY).some((t) => t.parentId === task.id));
  const expanded = useUi((s) => !s.collapsedTasks[task.id]);
  const tabStop = useUi((s) => s.activeKey === key);
  const setActive = useUi((s) => s.setActive);
  const setTaskExpanded = useUi((s) => s.setTaskExpanded);
  const { updateTask, deleteTask, createTask, reorderSiblings } = usePlanner.getState();
  const finePointer = useFinePointer();
  const dragControls = useDragControls();

  const [renaming, setRenaming] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [addingChild, setAddingChild] = useState(false);
  const [moving, setMoving] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const pending = isTempId(task.id);
  const allowChild = canAddChild(task.depth);
  const showChildren = hasChildren || addingChild;
  const startRename = useCallback(() => {
    if (!pending) setRenaming(true);
  }, [pending]);
  const doubleActivate = useDoubleActivate(startRename, !pending && !renaming);

  const requestDelete = async () => {
    const all = usePlanner.getState().tasksByDate[task.date] ?? EMPTY;
    const descendants = subtreeIds(all, task.id).size - 1;
    const ok = await confirmAction({
      title: `Delete “${task.title}”?`,
      message:
        descendants > 0
          ? `This also deletes its ${descendants} sub-note${descendants === 1 ? "" : "s"}. This can’t be undone.`
          : "This can’t be undone.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (ok) await deleteTask(task.id);
  };

  const moveBy = (delta: number) => {
    const index = siblings.findIndex((t) => t.id === task.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= siblings.length) return;
    const ids = siblings.map((t) => t.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void reorderSiblings(task.date, task.parentId, ids);
  };

  const startAddChild = () => {
    setTaskExpanded(task.id, true);
    setAddingChild(true);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget || pending) return;
    if (e.key === "Enter" || e.key === "F2") {
      e.preventDefault();
      setRenaming(true);
    } else if (e.key === "Delete" || (e.key === "Backspace" && (e.metaKey || e.ctrlKey))) {
      e.preventDefault();
      void requestDelete();
    }
  };

  return (
    <Reorder.Item
      value={task.id}
      as="li"
      layout="position"
      dragListener={false}
      dragControls={dragControls}
      onDragEnd={onDragEnd}
      role="treeitem"
      aria-level={5 + task.depth}
      aria-expanded={showChildren ? expanded : undefined}
      aria-label={task.title}
      aria-busy={pending || undefined}
      aria-selected={tabStop}
      tabIndex={tabStop ? 0 : -1}
      data-node-key={key}
      data-kind="task"
      id={`task-${task.id}`}
      onKeyDown={onKeyDown}
      onFocus={(e) => e.target === e.currentTarget && setActive(key)}
      className="relative scroll-mt-[calc(env(safe-area-inset-top)+68px)] bg-surface outline-none"
    >
      <div
        className={`tree-row group relative flex items-start pr-1 ${pending ? "opacity-60" : ""}`}
        style={{ paddingLeft: indentFor(task.depth) }}
      >
        <FlashOverlay nodeKey={key} />
        {finePointer && !pending && (
          <span
            onPointerDown={(e) => {
              e.preventDefault();
              dragControls.start(e);
            }}
            className="absolute top-3 flex h-5 w-4 cursor-grab touch-none items-center justify-center text-label-3 opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing"
            style={{ left: `calc(${indentFor(task.depth)} - 18px)` }}
            title="Drag to reorder"
            aria-hidden="true"
          >
            <Grip size={14} />
          </span>
        )}

        {showChildren ? (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setTaskExpanded(task.id, !expanded)}
            className="flex h-11 w-7 shrink-0 items-center justify-center rounded-md hover:bg-fill"
            aria-label={expanded ? "Collapse sub-notes" : "Expand sub-notes"}
          >
            <Chevron open={expanded} size={14} />
          </button>
        ) : (
          <StatusDot statusId={task.statusId} />
        )}

        <div className="min-w-0 flex-1 py-[11px]">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            {renaming ? (
              <TitleEditor
                initial={task.title}
                onDone={(title) => {
                  setRenaming(false);
                  if (title && title !== task.title) void updateTask(task.id, { title });
                }}
              />
            ) : (
              <span
                {...doubleActivate}
                className="min-w-0 cursor-default break-words text-[15px] leading-[22px] [touch-action:manipulation]"
                title="Double-click to rename"
              >
                {task.title}
              </span>
            )}
            {!renaming && (
              <span className="flex items-center gap-1.5">
                <LabelPill kind="statuses" task={task} disabled={pending} />
                <LabelPill kind="priorities" task={task} disabled={pending} />
              </span>
            )}
          </div>
          {editingDescription ? (
            <DescriptionEditor
              initial={task.description ?? ""}
              onDone={(description) => {
                setEditingDescription(false);
                if (description !== null && description !== (task.description ?? "")) {
                  void updateTask(task.id, { description: description || null });
                }
              }}
            />
          ) : (
            task.description && (
              <p
                className="mt-1 line-clamp-4 whitespace-pre-wrap break-words text-[13px] leading-[18px] text-label-2"
                onDoubleClick={() => !pending && setEditingDescription(true)}
              >
                {task.description}
              </p>
            )
          )}
        </div>

        <TaskMenu
          open={menuOpen}
          setOpen={setMenuOpen}
          disabled={pending}
          title={task.title}
          canAddChild={allowChild}
          hasDescription={!!task.description}
          canMoveUp={siblings[0]?.id !== task.id}
          canMoveDown={siblings[siblings.length - 1]?.id !== task.id}
          onRename={() => setRenaming(true)}
          onAddChild={startAddChild}
          onEditDescription={() => setEditingDescription(true)}
          onMoveUp={() => moveBy(-1)}
          onMoveDown={() => moveBy(1)}
          onMoveToDay={() => setMoving(true)}
          onDelete={() => void requestDelete()}
        />
      </div>

      {showChildren && (
        <Collapsible open={expanded}>
          <TaskList date={task.date} parentId={task.id} depth={depth + 1} />
          {addingChild && allowChild && (
            <div style={{ paddingLeft: indentFor(task.depth + 1) }}>
              <AddTaskInput
                placeholder="New sub-note"
                onSubmit={(title) => void createTask({ date: task.date, title, parentId: task.id })}
                onClose={() => setAddingChild(false)}
              />
            </div>
          )}
        </Collapsible>
      )}

      <MoveTaskDialog
        open={moving}
        date={task.date}
        title={task.title}
        onClose={() => setMoving(false)}
        onMove={(date) => {
          setMoving(false);
          if (date !== task.date) void updateTask(task.id, { date });
        }}
      />
    </Reorder.Item>
  );
});

function StatusDot({ statusId }: { statusId: string | null }) {
  const color = usePlanner((s) => s.statuses.find((l) => l.id === statusId)?.color);
  return (
    <span className="flex h-11 w-7 shrink-0 items-center justify-center" aria-hidden="true">
      <span
        className="size-[9px] rounded-full"
        style={color ? { background: color } : { boxShadow: "inset 0 0 0 1.5px var(--label-3)" }}
      />
    </span>
  );
}

/** "+ Add task" at the bottom of a day. */
export function AddTaskRow({ date }: { date: string }) {
  const [adding, setAdding] = useState(false);
  const createTask = usePlanner((s) => s.createTask);
  return (
    <div className="pb-1 pr-4" style={{ paddingLeft: indentFor(0) }}>
      {adding ? (
        <AddTaskInput
          placeholder="New task"
          onSubmit={(title) => void createTask({ date, title })}
          onClose={() => setAdding(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="pressable -ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-[15px] text-accent hover:bg-accent-tint"
        >
          <Plus size={17} />
          Add task
        </button>
      )}
    </div>
  );
}
