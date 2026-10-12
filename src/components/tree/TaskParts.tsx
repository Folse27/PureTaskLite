"use client";

import { useRef, useState } from "react";
import { usePlanner } from "@/client/planner-store";
import type { LabelKind, Task } from "@/lib/types";
import {
  ArrowDown,
  ArrowUp,
  CalendarMove,
  Check,
  Ellipsis,
  Flag,
  Pencil,
  SubItem,
  TextAlign,
  Trash,
} from "../icons";
import { Alert, AlertButton } from "../ui/Modal";
import { MenuItem, MenuSeparator, Popover } from "../ui/Popover";

/** Single-line input for new tasks/sub-notes. Enter adds and stays open for the next one. */
export function AddTaskInput({
  placeholder,
  onSubmit,
  onClose,
}: {
  placeholder: string;
  onSubmit: (title: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState("");
  const submit = () => {
    const title = value.trim();
    if (title) onSubmit(title);
    setValue("");
    return !!title;
  };
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Enter") {
          e.preventDefault();
          if (!submit()) onClose();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
      onBlur={() => {
        submit();
        onClose();
      }}
      placeholder={placeholder}
      aria-label={placeholder}
      maxLength={500}
      enterKeyHint="done"
      className="my-1.5 h-9 w-full rounded-lg bg-fill px-3 text-[15px] text-label outline-none placeholder:text-label-3 focus:ring-2 focus:ring-accent"
    />
  );
}

/** Inline rename: Enter saves, Escape cancels, blur saves. Calls onDone(null) when cancelled. */
export function TitleEditor({ initial, onDone }: { initial: string; onDone: (title: string | null) => void }) {
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value === null ? null : value.trim() || null);
  };
  return (
    <input
      autoFocus
      defaultValue={initial}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        e.stopPropagation();
        if (e.key === "Enter") {
          e.preventDefault();
          finish(e.currentTarget.value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(null);
        }
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      aria-label="Task title"
      maxLength={500}
      enterKeyHint="done"
      className="-mx-1.5 h-[30px] min-w-0 flex-1 basis-full rounded-md bg-surface px-1.5 text-[15px] text-label outline-none ring-2 ring-accent"
    />
  );
}

/** Multi-line details editor: blur or ⌘/Ctrl+Enter saves, Escape cancels (onDone(null)). */
export function DescriptionEditor({ initial, onDone }: { initial: string; onDone: (value: string | null) => void }) {
  const done = useRef(false);
  const finish = (value: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(value === null ? null : value.trim());
  };
  return (
    <textarea
      autoFocus
      defaultValue={initial}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          e.preventDefault();
          finish(null);
        } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          finish(e.currentTarget.value);
        }
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
      placeholder="Add details"
      aria-label="Details"
      maxLength={5000}
      rows={3}
      className="mt-1.5 block min-h-[72px] w-full resize-y rounded-lg bg-fill px-3 py-2 text-[14px] leading-[20px] text-label outline-none [field-sizing:content] placeholder:text-label-3 focus:ring-2 focus:ring-accent"
    />
  );
}

/** Small colored pill for a task's status or priority; tap to pick another. */
export function LabelPill({ kind, task, disabled }: { kind: LabelKind; task: Task; disabled?: boolean }) {
  const field = kind === "statuses" ? "statusId" : "priorityId";
  const labels = usePlanner((s) => s[kind]);
  const updateTask = usePlanner((s) => s.updateTask);
  const current = labels.find((l) => l.id === task[field]);
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const noun = kind === "statuses" ? "Status" : "Priority";

  const choose = (id: string | null) => {
    setOpen(false);
    ref.current?.focus();
    if (id !== task[field]) void updateTask(task.id, { [field]: id });
  };

  return (
    <>
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${noun}: ${current?.name ?? "none"}. Change ${noun.toLowerCase()}`}
        className={`pressable relative inline-flex h-6 max-w-[11rem] items-center gap-1.5 rounded-full px-2 text-[12px] font-medium leading-none after:absolute after:-inset-x-0.5 after:-inset-y-2.5 after:content-[''] disabled:cursor-default ${
          current ? "text-label" : "text-label-2 shadow-[inset_0_0_0_1px_var(--separator)] hover:bg-fill"
        }`}
        style={current ? { background: `color-mix(in srgb, ${current.color} 17%, transparent)` } : undefined}
      >
        {current ? (
          <>
            <span className="size-2 shrink-0 rounded-full" style={{ background: current.color }} aria-hidden="true" />
            <span className="truncate">{current.name}</span>
          </>
        ) : kind === "priorities" ? (
          <Flag size={12} />
        ) : (
          <span>No status</span>
        )}
      </button>
      <Popover open={open} anchorRef={ref} onClose={() => setOpen(false)} label={`Choose ${noun.toLowerCase()}`} width={220}>
        {labels.map((l) => (
          <MenuItem
            key={l.id}
            radio
            checked={l.id === task[field]}
            onSelect={() => choose(l.id)}
            icon={<span className="size-2.5 rounded-full" style={{ background: l.color }} />}
          >
            <span className="flex items-center justify-between gap-2">
              {l.name}
              {l.id === task[field] && <Check size={16} className="text-accent" />}
            </span>
          </MenuItem>
        ))}
        {labels.length > 0 && <MenuSeparator />}
        <MenuItem radio checked={!task[field]} onSelect={() => choose(null)} icon={<span className="size-2.5 rounded-full shadow-[inset_0_0_0_1.5px_var(--label-3)]" />}>
          <span className="flex items-center justify-between gap-2">
            No {noun.toLowerCase()}
            {!task[field] && <Check size={16} className="text-accent" />}
          </span>
        </MenuItem>
      </Popover>
    </>
  );
}

interface TaskMenuProps {
  open: boolean;
  setOpen: (open: boolean) => void;
  disabled: boolean;
  title: string;
  canAddChild: boolean;
  hasDescription: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onRename: () => void;
  onAddChild: () => void;
  onEditDescription: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMoveToDay: () => void;
  onDelete: () => void;
}

export function TaskMenu(p: TaskMenuProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const run = (fn: () => void) => () => {
    p.setOpen(false);
    fn();
  };
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={p.disabled}
        onClick={() => p.setOpen(!p.open)}
        aria-haspopup="menu"
        aria-expanded={p.open}
        aria-label={`Actions for “${p.title}”`}
        className="pressable flex size-11 shrink-0 items-center justify-center rounded-full text-label-2 hover:bg-fill disabled:opacity-40"
      >
        <Ellipsis size={18} />
      </button>
      <Popover open={p.open} anchorRef={buttonRef} onClose={() => p.setOpen(false)} label="Task actions">
        <MenuItem icon={<Pencil size={17} />} onSelect={run(p.onRename)}>
          Rename
        </MenuItem>
        {p.canAddChild && (
          <MenuItem icon={<SubItem size={17} />} onSelect={run(p.onAddChild)}>
            Add sub-note
          </MenuItem>
        )}
        <MenuItem icon={<TextAlign size={17} />} onSelect={run(p.onEditDescription)}>
          {p.hasDescription ? "Edit details" : "Add details"}
        </MenuItem>
        <MenuSeparator />
        {p.canMoveUp && (
          <MenuItem icon={<ArrowUp size={17} />} onSelect={run(p.onMoveUp)}>
            Move up
          </MenuItem>
        )}
        {p.canMoveDown && (
          <MenuItem icon={<ArrowDown size={17} />} onSelect={run(p.onMoveDown)}>
            Move down
          </MenuItem>
        )}
        <MenuItem icon={<CalendarMove size={17} />} onSelect={run(p.onMoveToDay)}>
          Move to another day…
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Trash size={17} />} destructive onSelect={run(p.onDelete)}>
          Delete
        </MenuItem>
      </Popover>
    </>
  );
}

export function MoveTaskDialog({
  open,
  date,
  title,
  onClose,
  onMove,
}: {
  open: boolean;
  date: string;
  title: string;
  onClose: () => void;
  onMove: (date: string) => void;
}) {
  // Uncontrolled: the input remounts (with the current date) each time the dialog opens.
  const input = useRef<HTMLInputElement>(null);
  const submit = () => {
    const value = input.current?.value ?? "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) onMove(value);
  };
  return (
    <Alert
      open={open}
      onClose={onClose}
      title="Move to another day"
      message={`“${title}” and its sub-notes will move to the chosen day.`}
      actions={
        <>
          <AlertButton onClick={onClose}>Cancel</AlertButton>
          <AlertButton onClick={submit} primary>
            Move
          </AlertButton>
        </>
      }
    >
      <input
        ref={input}
        type="date"
        data-autofocus
        defaultValue={date}
        min="2024-01-01"
        onKeyDown={(e) => e.key === "Enter" && submit()}
        aria-label="New date"
        className="mt-4 h-11 w-full rounded-xl bg-fill px-3 text-[16px] text-label outline-none focus:ring-2 focus:ring-accent"
      />
    </Alert>
  );
}
