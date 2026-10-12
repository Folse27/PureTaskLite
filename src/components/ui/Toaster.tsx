"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useToasts } from "@/client/toast-store";
import { SPRING } from "@/client/motion";

/** Transient messages (e.g. "Couldn't save — your change was undone"). */
export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  const reduceMotion = useReducedMotion();
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4"
      style={{ top: "calc(env(safe-area-inset-top) + 64px)" }}
      role="status"
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            type="button"
            layout={!reduceMotion}
            onClick={() => dismiss(t.id)}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -16, scale: 0.96 }}
            transition={SPRING}
            className="material-thick pointer-events-auto max-w-md rounded-2xl border border-separator px-4 py-3 text-left text-[14px] font-medium leading-snug shadow-float"
          >
            {t.tone === "error" && <span className="mr-1.5 text-danger" aria-hidden="true">●</span>}
            {t.message}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
