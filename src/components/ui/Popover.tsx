"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { SPRING_FAST } from "@/client/motion";

const MARGIN = 8;
const ITEM_SELECTOR = '[role="menuitem"]:not([disabled]),[role="menuitemradio"]:not([disabled])';

interface PopoverProps {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  label: string;
  children: ReactNode;
  width?: number;
}

/**
 * Menu anchored to its trigger. It scales out of the trigger (transform-origin
 * on the anchor side), closes on outside press / Escape / scroll, supports
 * arrow-key navigation, and returns focus to the trigger.
 */
export function Popover({ open, anchorRef, onClose, label, children, width = 240 }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const [pos, setPos] = useState<{ top: number; left: number; originY: "top" | "bottom"; originX: number } | null>(
    null,
  );

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!open || !anchor) return;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const h = ref.current?.offsetHeight ?? 240;
      const w = Math.min(width, window.innerWidth - MARGIN * 2);
      const spaceBelow = window.innerHeight - a.bottom;
      const below = spaceBelow >= h + MARGIN || spaceBelow > a.top;
      const top = below ? a.bottom + 4 : Math.max(MARGIN, a.top - h - 4);
      const left = Math.min(Math.max(MARGIN, a.right - w), window.innerWidth - w - MARGIN);
      setPos({ top, left, originY: below ? "top" : "bottom", originX: a.left + a.width / 2 - left });
    };
    place();
    const raf = requestAnimationFrame(place); // re-place once content height is known
    window.addEventListener("resize", place);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
    };
  }, [open, anchorRef, width]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onScroll = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    const focusTimer = requestAnimationFrame(() => {
      const items = ref.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR);
      const checked = ref.current?.querySelector<HTMLElement>('[aria-checked="true"]');
      (checked ?? items?.[0])?.focus();
    });
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      cancelAnimationFrame(focusTimer);
    };
  }, [open, anchorRef, onClose]);

  const close = () => {
    onClose();
    anchorRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const move = (i: number) => items[(i + items.length) % items.length]?.focus();
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(index + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(index - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      move(0);
    } else if (e.key === "End") {
      e.preventDefault();
      move(items.length - 1);
    } else if (e.key === "Tab") {
      close();
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          className="material-thick fixed z-50 overflow-hidden rounded-[14px] border border-separator p-1.5 shadow-float"
          style={{
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            width: Math.min(width, typeof window === "undefined" ? width : window.innerWidth - MARGIN * 2),
            transformOrigin: `${pos?.originX ?? width}px ${pos?.originY ?? "top"}`,
          }}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
          transition={reduceMotion ? { duration: 0.12 } : SPRING_FAST}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

interface MenuItemProps {
  onSelect: () => void;
  icon?: ReactNode;
  children: ReactNode;
  destructive?: boolean;
  checked?: boolean;
  radio?: boolean;
}

export function MenuItem({ onSelect, icon, children, destructive, checked, radio }: MenuItemProps) {
  return (
    <button
      type="button"
      role={radio ? "menuitemradio" : "menuitem"}
      aria-checked={radio ? !!checked : undefined}
      tabIndex={-1}
      onClick={onSelect}
      className={`flex min-h-11 w-full items-center gap-3 rounded-[9px] px-3 text-left text-[15px] outline-none hover:bg-fill focus-visible:bg-fill focus-visible:outline-none active:bg-fill-strong ${
        destructive ? "text-danger" : "text-label"
      }`}
    >
      {icon && <span className="flex w-5 shrink-0 justify-center">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="mx-2 my-1 h-px bg-separator" />;
}
