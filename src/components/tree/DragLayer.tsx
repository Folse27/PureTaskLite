"use client";

import { motion, useReducedMotion } from "motion/react";
import { createPortal } from "react-dom";
import { useDrag } from "@/client/dnd";
import { SPRING_FAST } from "@/client/motion";
import { Grip } from "../icons";

/** The lifted task following the pointer, plus the drop indicator. */
export function DragLayer() {
  const active = useDrag((s) => s.active);
  const target = useDrag((s) => s.target);
  const reduceMotion = useReducedMotion();
  if (!active || typeof document === "undefined") return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[70]" aria-hidden="true">
      {target &&
        (target.kind === "before" || target.kind === "after" ? (
          <div
            className="absolute flex items-center"
            style={{
              left: target.lineLeft - 4,
              top: (target.kind === "before" ? target.rect.top : target.rect.top + target.rect.height) - 4,
              width: Math.max(40, target.rect.left + target.rect.width - target.lineLeft - 8),
            }}
          >
            <span className="size-2 shrink-0 rounded-full border-2 border-accent bg-surface" />
            <span className="h-0.5 flex-1 rounded-full bg-accent" />
          </div>
        ) : (
          <div
            className="absolute rounded-[10px] bg-accent-tint ring-2 ring-accent"
            style={{ left: target.rect.left, top: target.rect.top, width: target.rect.width, height: target.rect.height }}
          />
        ))}

      <motion.div
        className="material-thick absolute flex items-center gap-2 rounded-xl border border-separator px-3 py-2.5 shadow-float"
        style={{
          // Keep the lifted task inside the screen (on phones the row is nearly as wide as the viewport).
          left: Math.max(8, Math.min(active.x - active.offsetX, window.innerWidth - active.width - 8)),
          top: active.y - active.offsetY,
          width: Math.min(active.width, window.innerWidth - 16),
        }}
        initial={reduceMotion ? false : { scale: 1, opacity: 0.6 }}
        animate={{ scale: reduceMotion ? 1 : 1.03, opacity: 0.96 }}
        transition={SPRING_FAST}
      >
        <Grip size={14} className="shrink-0 text-label-3" />
        <span className="truncate text-[15px] font-medium">{active.title}</span>
      </motion.div>

      {!target && (
        <div
          className="material-thick absolute rounded-full border border-separator px-3 py-1 text-[12px] font-medium text-label-2 shadow-soft"
          style={{ left: active.x + 14, top: active.y + 22 }}
        >
          Drop on a task or a day
        </div>
      )}
    </div>,
    document.body,
  );
}
