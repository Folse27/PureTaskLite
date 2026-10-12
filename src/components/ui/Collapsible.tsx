"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { SPRING } from "@/client/motion";

/**
 * Height-animated disclosure content. Children are only mounted while open
 * (lazy tree), and the spring starts from the current height, so rapid
 * toggling reverses smoothly mid-flight instead of jumping.
 */
export function Collapsible({ open, children }: { open: boolean; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  const transition = reduceMotion
    ? { height: { duration: 0 }, opacity: { duration: 0.15 } }
    : { height: SPRING, opacity: { duration: 0.2, ease: "easeOut" as const } };

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="content"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={transition}
          style={{ overflow: "hidden" }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
