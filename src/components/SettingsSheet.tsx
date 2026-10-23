"use client";

import { motion, useReducedMotion } from "motion/react";
import { useRef, useState } from "react";
import { api } from "@/client/api";
import { useTheme, type ThemeChoice } from "@/client/hooks";
import { SPRING_FAST } from "@/client/motion";
import { usePlanner } from "@/client/planner-store";
import { PALETTE } from "@/lib/colors";
import type { Label, LabelKind } from "@/lib/types";
import { ArrowDown, ArrowUp, Check, Logout, Plus, Trash } from "./icons";
import { Alert, AlertButton, Sheet } from "./ui/Modal";
import { MenuItem, Popover } from "./ui/Popover";

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      <div className="space-y-7 bg-bg px-4 pb-8 pt-5 sm:px-5">
        <Section title="Statuses">
          <LabelEditor kind="statuses" />
        </Section>
        <Section title="Priorities">
          <LabelEditor kind="priorities" />
        </Section>
        <Section title="Appearance">
          <ThemePicker />
        </Section>
        <SignOut />
      </div>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-[0.04em] text-label-2">{title}</h3>
      {children}
    </section>
  );
}

function LabelEditor({ kind }: { kind: LabelKind }) {
  const labels = usePlanner((s) => s[kind]);
  const { createLabel, reorderLabels, deleteLabel } = usePlanner.getState();
  const [focusId, setFocusId] = useState<string | null>(null);
  const [reassign, setReassign] = useState<{ label: Label; inUse: number } | null>(null);
  const noun = kind === "statuses" ? "status" : "priority";

  const add = async () => {
    const used = new Set(labels.map((l) => l.color.toUpperCase()));
    const color = PALETTE.find((c) => !used.has(c.value))?.value ?? PALETTE[0].value;
    const label = await createLabel(kind, kind === "statuses" ? "New status" : "New priority", color);
    if (label) setFocusId(label.id);
  };

  const move = (index: number, delta: number) => {
    const ids = labels.map((l) => l.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void reorderLabels(kind, ids);
  };

  const remove = async (label: Label) => {
    const result = await deleteLabel(kind, label.id);
    if (typeof result === "object") setReassign({ label, inUse: result.inUse });
  };

  return (
    <div className="overflow-hidden rounded-xl bg-surface shadow-soft">
      <ul>
        {labels.map((label, i) => (
          <li
            key={label.id}
            className={`flex items-center gap-1 pl-1.5 pr-1 ${i > 0 ? "border-t border-separator" : ""}`}
          >
            <ColorButton kind={kind} label={label} />
            <NameInput kind={kind} label={label} autoFocus={focusId === label.id} />
            <IconButton label={`Move ${label.name} up`} disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp size={17} />
            </IconButton>
            <IconButton label={`Move ${label.name} down`} disabled={i === labels.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown size={17} />
            </IconButton>
            <IconButton label={`Delete ${label.name}`} danger onClick={() => void remove(label)}>
              <Trash size={17} />
            </IconButton>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => void add()}
        className={`flex min-h-11 w-full items-center gap-2 px-4 text-[15px] text-accent hover:bg-fill ${
          labels.length ? "border-t border-separator" : ""
        }`}
      >
        <Plus size={17} />
        Add {noun}
      </button>

      <ReassignDialog
        kind={kind}
        target={reassign}
        others={labels.filter((l) => l.id !== reassign?.label.id)}
        onClose={() => setReassign(null)}
        onConfirm={async (choice) => {
          const label = reassign!.label;
          setReassign(null);
          await deleteLabel(kind, label.id, choice);
        }}
      />
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`pressable flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-fill disabled:opacity-30 disabled:hover:bg-transparent ${
        danger ? "text-danger" : "text-label-2"
      }`}
    >
      {children}
    </button>
  );
}

function NameInput({ kind, label, autoFocus }: { kind: LabelKind; label: Label; autoFocus: boolean }) {
  const updateLabel = usePlanner((s) => s.updateLabel);
  const [value, setValue] = useState(label.name);
  const [prev, setPrev] = useState(label.name);
  if (label.name !== prev) {
    // Follow external changes (e.g. rollback) while not being edited.
    setPrev(label.name);
    setValue(label.name);
  }
  const save = () => {
    const name = value.trim();
    if (!name) setValue(label.name);
    else if (name !== label.name) void updateLabel(kind, label.id, { name });
  };
  return (
    <input
      value={value}
      autoFocus={autoFocus}
      onFocus={(e) => autoFocus && e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          e.stopPropagation();
          setValue(label.name);
          requestAnimationFrame(() => e.currentTarget?.blur());
        }
      }}
      maxLength={40}
      aria-label={`${kind === "statuses" ? "Status" : "Priority"} name`}
      className="h-11 min-w-0 flex-1 rounded-lg bg-transparent px-2 text-[16px] text-label outline-none focus:bg-fill"
    />
  );
}

function ColorButton({ kind, label }: { kind: LabelKind; label: Label }) {
  const updateLabel = usePlanner((s) => s.updateLabel);
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const pick = (color: string) => {
    if (color.toUpperCase() !== label.color.toUpperCase())
      void updateLabel(kind, label.id, { color: color.toUpperCase() });
  };
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Color of ${label.name}`}
        className="pressable flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-fill"
      >
        <span
          className="size-6 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.1)]"
          style={{ background: label.color }}
        />
      </button>
      <Popover open={open} anchorRef={ref} onClose={() => setOpen(false)} label={`Color of ${label.name}`} width={252}>
        <div className="grid grid-cols-5 gap-1 p-1">
          {PALETTE.map((c) => {
            const selected = c.value.toUpperCase() === label.color.toUpperCase();
            return (
              <button
                key={c.value}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                aria-label={c.name}
                title={c.name}
                tabIndex={-1}
                onClick={() => {
                  pick(c.value);
                  setOpen(false);
                  ref.current?.focus();
                }}
                className="flex size-11 items-center justify-center rounded-full hover:bg-fill focus-visible:bg-fill"
              >
                <span
                  className="flex size-7 items-center justify-center rounded-full text-white"
                  style={{ background: c.value }}
                >
                  {selected && <Check size={15} strokeWidth={2.6} />}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mx-1 mb-1 mt-1 border-t border-separator pt-1">
          <MenuItem
            onSelect={() => document.getElementById(`custom-color-${label.id}`)?.click()}
            icon={
              <span
                className="size-5 rounded-full"
                style={{ background: "conic-gradient(#ff3b30, #ffcc00, #34c759, #32ade6, #5856d6, #ff2d55, #ff3b30)" }}
              />
            }
          >
            Custom color…
          </MenuItem>
          <input
            id={`custom-color-${label.id}`}
            type="color"
            defaultValue={label.color}
            onChange={(e) => pick(e.target.value)}
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
          />
        </div>
      </Popover>
    </>
  );
}

function ReassignDialog({
  kind,
  target,
  others,
  onClose,
  onConfirm,
}: {
  kind: LabelKind;
  target: { label: Label; inUse: number } | null;
  others: Label[];
  onClose: () => void;
  onConfirm: (choice: string) => void;
}) {
  const [choice, setChoice] = useState("none");
  const noun = kind === "statuses" ? "status" : "priority";
  return (
    <Alert
      open={!!target}
      onClose={onClose}
      title={`Delete “${target?.label.name ?? ""}”?`}
      message={`It’s used by ${target?.inUse ?? 0} task${target?.inUse === 1 ? "" : "s"}. Give ${
        target?.inUse === 1 ? "it" : "them"
      } this ${noun} instead:`}
      actions={
        <>
          <AlertButton onClick={onClose}>Cancel</AlertButton>
          <AlertButton onClick={() => onConfirm(choice)} destructive primary>
            Delete
          </AlertButton>
        </>
      }
    >
      <fieldset className="mt-3 max-h-56 overflow-y-auto rounded-xl bg-fill text-left">
        <legend className="sr-only">Reassign tasks to</legend>
        {[...others, null].map((l) => {
          const value = l?.id ?? "none";
          return (
            <label key={value} className="flex min-h-11 cursor-pointer items-center gap-3 px-3 text-[15px]">
              <input
                type="radio"
                name="reassign"
                value={value}
                checked={choice === value}
                onChange={() => setChoice(value)}
                data-autofocus={value === "none" ? true : undefined}
                className="size-4 accent-[var(--accent)]"
              />
              {l ? (
                <span className="size-2.5 rounded-full" style={{ background: l.color }} aria-hidden="true" />
              ) : (
                <span className="size-2.5 rounded-full shadow-[inset_0_0_0_1.5px_var(--label-3)]" aria-hidden="true" />
              )}
              {l?.name ?? `No ${noun}`}
            </label>
          );
        })}
      </fieldset>
    </Alert>
  );
}

const THEME_OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function ThemePicker() {
  const { choice, setChoice } = useTheme();
  const reduceMotion = useReducedMotion();
  return (
    <div role="radiogroup" aria-label="Theme" className="flex rounded-[10px] bg-fill p-0.5">
      {THEME_OPTIONS.map((o) => {
        const selected = choice === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setChoice(o.value)}
            className="relative min-h-11 flex-1 rounded-[8px] text-[14px] font-medium"
          >
            {selected && (
              <motion.span
                layoutId="theme-thumb"
                transition={reduceMotion ? { duration: 0 } : SPRING_FAST}
                className="absolute inset-0 rounded-[8px] bg-elevated shadow-soft"
              />
            )}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function SignOut() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api("/api/auth/logout", { method: "POST" });
        } finally {
          // Full reload on purpose: the session is gone, so drop all client state.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.href = "/login";
        }
      }}
      className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-surface text-[16px] text-danger shadow-soft hover:bg-fill disabled:opacity-50"
    >
      <Logout size={18} />
      Sign out
    </button>
  );
}
