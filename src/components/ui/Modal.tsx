"use client";

import { AnimatePresence, motion, useDragControls, useReducedMotion, type PanInfo } from "motion/react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useMediaQuery } from "@/client/hooks";
import { project, SPRING, SPRING_FAST } from "@/client/motion";
import { XMark } from "../icons";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** Focus trap, Escape to close, scroll lock, and focus restore for modal surfaces. */
function useModalBehaviour(open: boolean, onClose: () => void, ref: React.RefObject<HTMLElement | null>) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    const raf = requestAnimationFrame(() => {
      const target = ref.current?.querySelector<HTMLElement>("[data-autofocus]") ?? ref.current;
      target?.focus({ preventScroll: true });
    });
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
      } else if (e.key === "Tab" && ref.current) {
        const items = Array.from(ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
          (el) => el.offsetParent !== null,
        );
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = overflow;
      previous?.focus?.({ preventScroll: true });
    };
  }, [open, ref]);
}

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Modal sheet: slides up from the bottom on phones (drag the grabber down to
 * dismiss — momentum is projected, so a flick closes it), and appears as a
 * centered panel on larger screens. Enters and exits along the same path.
 */
export function Sheet({ open, onClose, title, children, footer }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const phone = useMediaQuery("(max-width: 639px)");
  const reduceMotion = useReducedMotion();
  const dragControls = useDragControls();
  useModalBehaviour(open, onClose, ref);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const height = ref.current?.offsetHeight ?? 600;
    const projected = info.offset.y + project(info.velocity.y);
    if (projected > height * 0.35) onClose();
  };

  const hidden = reduceMotion ? { opacity: 0 } : phone ? { y: "100%" } : { opacity: 0, scale: 0.96 };
  const shown = reduceMotion ? { opacity: 1 } : phone ? { y: 0 } : { opacity: 1, scale: 1 };

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center sm:p-6">
          <motion.div
            className="absolute inset-0 bg-[var(--scrim)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[22px] bg-surface shadow-float outline-none sm:max-h-[min(780px,90dvh)] sm:max-w-lg sm:rounded-[22px]"
            initial={hidden}
            animate={shown}
            exit={hidden}
            transition={reduceMotion ? { duration: 0.15 } : SPRING}
            drag={phone && !reduceMotion ? "y" : false}
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.04, bottom: 1 }}
            dragSnapToOrigin
            onDragEnd={onDragEnd}
          >
            <header
              className="relative shrink-0 touch-none border-b border-separator px-5 pb-3 pt-2 sm:pt-4"
              onPointerDown={(e) => phone && dragControls.start(e)}
            >
              <div className="mx-auto mb-2 h-[5px] w-9 rounded-full bg-fill-strong sm:hidden" aria-hidden="true" />
              <div className="flex items-center justify-between gap-3">
                <h2 id={titleId} className="text-[20px] font-semibold tracking-[-0.02em]">
                  {title}
                </h2>
                <button
                  type="button"
                  onClick={onClose}
                  className="pressable -mr-2 flex size-11 items-center justify-center rounded-full text-label-2 hover:bg-fill"
                  aria-label="Close"
                >
                  <span className="flex size-8 items-center justify-center rounded-full bg-fill">
                    <XMark size={16} />
                  </span>
                </button>
              </div>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
            {footer && <div className="safe-bottom shrink-0 border-t border-separator">{footer}</div>}
            {!footer && <div className="safe-bottom shrink-0" />}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

interface AlertProps {
  open: boolean;
  onClose: () => void;
  title: string;
  message?: ReactNode;
  children?: ReactNode;
  actions: ReactNode;
}

/** Small centered alert dialog (iOS alert style) for confirmations and short choices. */
export function Alert({ open, onClose, title, message, children, actions }: AlertProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descId = useId();
  const reduceMotion = useReducedMotion();
  useModalBehaviour(open, onClose, ref);

  if (typeof document === "undefined") return null;
  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
          <motion.div
            className="absolute inset-0 bg-[var(--scrim)]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            ref={ref}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={message ? descId : undefined}
            tabIndex={-1}
            className="relative w-full max-w-[340px] overflow-hidden rounded-[18px] bg-elevated shadow-float outline-none"
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 1.08 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.96 }}
            transition={reduceMotion ? { duration: 0.12 } : SPRING_FAST}
          >
            <div className="px-5 pb-4 pt-5 text-center">
              <h2 id={titleId} className="text-[17px] font-semibold leading-snug tracking-[-0.01em]">
                {title}
              </h2>
              {message && (
                <div id={descId} className="mt-1.5 text-[14px] leading-snug text-label-2">
                  {message}
                </div>
              )}
              {children}
            </div>
            <div className="flex border-t border-separator [&>*+*]:border-l [&>*+*]:border-separator">{actions}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function AlertButton({
  onClick,
  children,
  destructive,
  primary,
  autoFocus,
  disabled,
}: {
  onClick: () => void;
  children: ReactNode;
  destructive?: boolean;
  primary?: boolean;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-autofocus={autoFocus ? true : undefined}
      className={`min-h-11 flex-1 px-3 py-3 text-[17px] hover:bg-fill active:bg-fill-strong disabled:opacity-40 ${
        destructive ? "text-danger" : "text-accent"
      } ${primary ? "font-semibold" : ""}`}
    >
      {children}
    </button>
  );
}
