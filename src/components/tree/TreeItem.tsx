"use client";

import type { CSSProperties, ReactNode } from "react";
import { useUi } from "@/client/ui-store";
import { Collapsible } from "../ui/Collapsible";
import { ChevronRight } from "../icons";

/** Remounts a one-shot highlight whenever this node is flashed. */
export function FlashOverlay({ nodeKey }: { nodeKey: string }) {
  const nonce = useUi((s) => (s.flash?.key === nodeKey ? s.flash.nonce : null));
  if (!nonce) return null;
  return <span key={nonce} className="flash pointer-events-none absolute inset-0 rounded-[10px]" aria-hidden="true" />;
}

/**
 * Thin vertical line under a parent row's chevron, running alongside its
 * children, so it's obvious at a glance which items belong to the same group.
 */
export function GuideLine({ left }: { left: string }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute bottom-2 top-0 z-[1] w-px bg-guide"
      style={{ left }}
    />
  );
}

export function Chevron({ open, size = 16 }: { open: boolean; size?: number }) {
  return (
    <ChevronRight
      size={size}
      className="shrink-0 text-label-3 transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
      style={{ transform: open ? "rotate(90deg)" : "none" }}
    />
  );
}

export function CountBadge({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null;
  return (
    <span
      className="tabular ml-auto inline-flex h-[22px] min-w-[22px] shrink-0 items-center justify-center rounded-full bg-fill px-1.5 text-[12px] font-semibold text-label-2"
      aria-label={`${count} ${label}${count === 1 ? "" : "s"}`}
    >
      {count}
    </span>
  );
}

interface DateTreeItemProps {
  nodeKey: string;
  level: number;
  /** Accessible name (the visible row text, without the subtree). */
  label: string;
  expanded: boolean;
  onToggle: () => void;
  /** First node of the tree is the Tab stop until another node becomes active. */
  defaultTabStop?: boolean;
  row: ReactNode;
  rowClassName?: string;
  rowStyle?: CSSProperties;
  groupClassName?: string;
  /** Render children directly (they bring their own role="group" list). */
  bareChildren?: boolean;
  /** Horizontal position of the guide line (the centre of this row's chevron). */
  guide?: string;
  /** Extra data attributes for the row (e.g. drop targets). */
  rowData?: Record<string, string>;
  children: ReactNode;
}

/** A collapsible calendar node (year/month/week/day) following the ARIA tree pattern. */
export function DateTreeItem({
  nodeKey,
  level,
  label,
  expanded,
  onToggle,
  defaultTabStop,
  row,
  rowClassName = "",
  rowStyle,
  groupClassName,
  bareChildren,
  guide,
  rowData,
  children,
}: DateTreeItemProps) {
  const tabStop = useUi((s) => s.activeKey === nodeKey || (s.activeKey === null && !!defaultTabStop));
  const setActive = useUi((s) => s.setActive);

  return (
    <li
      role="treeitem"
      aria-level={level}
      aria-expanded={expanded}
      aria-selected={tabStop}
      aria-label={label}
      tabIndex={tabStop ? 0 : -1}
      data-node-key={nodeKey}
      data-kind="date"
      onFocus={(e) => e.target === e.currentTarget && setActive(nodeKey)}
      className="scroll-mt-[calc(env(safe-area-inset-top)+68px)] outline-none"
    >
      <div
        {...rowData}
        className={`tree-row relative flex min-h-11 cursor-pointer select-none items-center gap-2 ${rowClassName}`}
        style={rowStyle}
        onClick={() => {
          setActive(nodeKey);
          onToggle();
        }}
      >
        <FlashOverlay nodeKey={nodeKey} />
        {row}
      </div>
      <Collapsible open={expanded}>
        <div className="relative">
          {guide && <GuideLine left={guide} />}
          {bareChildren ? (
            children
          ) : (
            <ul role="group" className={groupClassName}>
              {children}
            </ul>
          )}
        </div>
      </Collapsible>
    </li>
  );
}

/** Keyboard navigation for the whole tree (event delegation on role="tree"). */
export function handleTreeKeyDown(e: React.KeyboardEvent<HTMLElement>) {
  const item = e.target as HTMLElement;
  if (item.getAttribute("role") !== "treeitem") return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]'));
  const index = items.indexOf(item);
  const key = item.dataset.nodeKey!;
  const expanded = item.getAttribute("aria-expanded");
  const ui = useUi.getState();

  const focus = (el: Element | null | undefined) => {
    if (!(el instanceof HTMLElement)) return;
    ui.setActive(el.dataset.nodeKey!);
    el.focus();
    el.scrollIntoView({ block: "nearest" });
  };
  const setOpen = (open: boolean) => {
    if (key.startsWith("t:")) ui.setTaskExpanded(key.slice(2), open);
    else ui.setExpanded(key, open);
  };

  switch (e.key) {
    case "ArrowDown":
      focus(items[index + 1]);
      break;
    case "ArrowUp":
      focus(items[index - 1]);
      break;
    case "Home":
      focus(items[0]);
      break;
    case "End":
      focus(items[items.length - 1]);
      break;
    case "ArrowRight":
      if (expanded === "false") setOpen(true);
      else if (expanded === "true") focus(item.querySelector('[role="group"] [role="treeitem"]'));
      else return;
      break;
    case "ArrowLeft":
      if (expanded === "true") setOpen(false);
      else focus(item.parentElement?.closest('[role="treeitem"]'));
      break;
    case "Enter":
    case " ":
      if (item.dataset.kind !== "date") return;
      setOpen(expanded !== "true");
      break;
    default:
      return;
  }
  e.preventDefault();
}
