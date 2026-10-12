"use client";

import { AnimatePresence, motion, useDragControls, useReducedMotion, type PanInfo } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useMediaQuery } from "@/client/hooks";
import { project, SPRING } from "@/client/motion";
import { revealTask } from "@/client/reveal";
import { useAssistant, type Phase, type Turn } from "@/client/voice/assistant-store";
import { dayLabel } from "@/lib/dates";
import type { AssistantChange } from "@/lib/types";
import { Mic, Send, Speaker, SpeakerOff, Stop, XMark } from "./icons";

const PHASE_TEXT: Record<Phase, string> = {
  idle: "",
  recording: "Listening…",
  listening: "Listening…",
  transcribing: "Transcribing…",
  thinking: "Thinking…",
};

function formatDuration(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function useElapsed(active: boolean, startedAt: number) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const tick = () => {
      setNow(performance.now());
      raf = window.setTimeout(tick, 250);
    };
    tick();
    return () => clearTimeout(raf);
  }, [active]);
  return active ? Math.max(0, now - startedAt) : 0;
}

/** Floating microphone button + assistant panel. */
export function AssistantDock({ today }: { today: string }) {
  const phase = useAssistant((s) => s.phase);
  const open = useAssistant((s) => s.open);
  const startedAt = useAssistant((s) => s.startedAt);
  const toggleMic = useAssistant((s) => s.toggleMic);
  const reduceMotion = useReducedMotion();
  const recording = phase === "recording" || phase === "listening";
  const busy = phase === "transcribing" || phase === "thinking";
  const elapsed = useElapsed(phase === "recording", startedAt);

  return (
    <>
      <AnimatePresence>{open && <AssistantPanel today={today} />}</AnimatePresence>

      <div
        className="fixed z-30 flex items-center gap-3"
        style={{
          right: "calc(env(safe-area-inset-right) + 20px)",
          bottom: "calc(env(safe-area-inset-bottom) + 20px)",
        }}
      >
        <AnimatePresence>
          {phase === "recording" && (
            <motion.div
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              transition={reduceMotion ? { duration: 0.12 } : SPRING}
              className="material-thick tabular flex h-9 items-center gap-2 rounded-full border border-separator px-3 text-[14px] font-semibold shadow-float"
              aria-hidden="true"
            >
              <span className="size-2 rounded-full bg-danger" />
              {formatDuration(elapsed)}
            </motion.div>
          )}
        </AnimatePresence>

        <button
          type="button"
          onClick={() => void toggleMic()}
          disabled={busy}
          aria-pressed={recording}
          aria-label={recording ? "Stop recording" : busy ? PHASE_TEXT[phase] : "Talk to the assistant"}
          className={`pressable relative flex size-[60px] items-center justify-center rounded-full text-white shadow-float disabled:cursor-wait ${
            recording ? "bg-danger-fill" : "bg-accent-fill"
          }`}
        >
          {recording && <span className="recording-pulse absolute inset-0 rounded-full bg-danger-fill" aria-hidden="true" />}
          {busy && (
            <span
              className="absolute inset-[-4px] animate-spin rounded-full border-[3px] border-transparent border-t-accent motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
          <span className="relative">{recording ? <Stop size={24} /> : <Mic size={26} />}</span>
        </button>
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {PHASE_TEXT[phase]}
      </p>
    </>
  );
}

function AssistantPanel({ today }: { today: string }) {
  const phase = useAssistant((s) => s.phase);
  const turns = useAssistant((s) => s.turns);
  const notice = useAssistant((s) => s.notice);
  const interim = useAssistant((s) => s.interim);
  const muted = useAssistant((s) => s.muted);
  const awaitingConfirm = useAssistant((s) => !!s.pendingDelete && s.phase === "idle");
  const { setOpen, reset, setMuted, send } = useAssistant.getState();
  const phone = useMediaQuery("(max-width: 639px)");
  const reduceMotion = useReducedMotion();
  const dragControls = useDragControls();
  const scroller = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: reduceMotion ? "auto" : "smooth" });
  }, [turns, phase, notice, interim, reduceMotion]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const height = panel.current?.offsetHeight ?? 400;
    if (info.offset.y + project(info.velocity.y) > height * 0.4) setOpen(false);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    setText("");
    void send(value);
  };

  const status = phase === "listening" && interim ? `“${interim}”` : PHASE_TEXT[phase];

  return (
    <motion.section
      ref={panel}
      aria-label="Assistant"
      className="material-thick fixed z-30 flex max-h-[min(62dvh,560px)] flex-col overflow-hidden rounded-[22px] border border-separator shadow-float sm:w-[400px]"
      style={{
        left: phone ? "calc(env(safe-area-inset-left) + 12px)" : undefined,
        right: "calc(env(safe-area-inset-right) + 12px)",
        bottom: "calc(env(safe-area-inset-bottom) + 92px)",
        transformOrigin: "calc(100% - 38px) calc(100% + 60px)",
      }}
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 24 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: 24 }}
      transition={reduceMotion ? { duration: 0.15 } : SPRING}
      drag={phone && !reduceMotion ? "y" : false}
      dragControls={dragControls}
      dragListener={false}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0.04, bottom: 1 }}
      dragSnapToOrigin
      onDragEnd={onDragEnd}
      onKeyDown={(e) => {
        if (e.key === "Escape") setOpen(false);
      }}
    >
      <header
        className="flex shrink-0 touch-none items-center gap-1 py-1 pl-4 pr-1.5"
        onPointerDown={(e) => phone && dragControls.start(e)}
      >
        <h2 className="flex-1 text-[15px] font-semibold">Assistant</h2>
        {turns.length > 0 && (
          <button
            type="button"
            onClick={reset}
            className="min-h-11 rounded-full px-3 text-[14px] text-accent hover:bg-fill"
          >
            New chat
          </button>
        )}
        <button
          type="button"
          onClick={() => setMuted(!muted)}
          aria-pressed={muted}
          aria-label={muted ? "Unmute spoken replies" : "Mute spoken replies"}
          className="flex size-11 items-center justify-center rounded-full text-label-2 hover:bg-fill"
        >
          {muted ? <SpeakerOff size={19} /> : <Speaker size={19} />}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close assistant"
          className="flex size-11 items-center justify-center rounded-full text-label-2 hover:bg-fill"
        >
          <XMark size={18} />
        </button>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-3" aria-live="polite">
        {turns.length === 0 && !notice && phase === "idle" && (
          <p className="py-2 text-[14px] leading-relaxed text-label-2">
            Tap the mic and say things like “Add buy milk tomorrow with high priority”, “What’s on this week?” or
            “Move the dentist to next Friday”.
          </p>
        )}
        {turns.map((t, i) => (
          <TurnView
            key={t.id}
            turn={t}
            today={today}
            onConfirm={i === turns.length - 1 && t.asksToConfirm && awaitingConfirm ? (yes) => void send(yes ? "Yes" : "No") : undefined}
          />
        ))}
        {status && (
          <p className="flex items-center gap-2 text-[14px] text-label-2">
            <span className="size-1.5 animate-pulse rounded-full bg-accent motion-reduce:animate-none" aria-hidden="true" />
            {status}
          </p>
        )}
        {notice && <p className="rounded-xl bg-fill px-3 py-2 text-[14px] leading-snug">{notice}</p>}
      </div>

      <form onSubmit={submit} className="flex shrink-0 items-center gap-2 border-t border-separator p-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a request"
          aria-label="Type a request"
          enterKeyHint="send"
          maxLength={2000}
          className="h-11 min-w-0 flex-1 rounded-full bg-fill px-4 text-[16px] text-label outline-none placeholder:text-label-3 focus:ring-2 focus:ring-accent"
        />
        <button
          type="submit"
          disabled={!text.trim() || phase === "thinking"}
          aria-label="Send"
          className="pressable flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-fill text-white disabled:opacity-35"
        >
          <Send size={19} />
        </button>
      </form>
    </motion.section>
  );
}

const CHANGE_VERB: Record<AssistantChange["kind"], string> = {
  created: "Added",
  updated: "Updated",
  moved: "Moved",
  deleted: "Deleted",
};

function TurnView({
  turn,
  today,
  onConfirm,
}: {
  turn: Turn;
  today: string;
  /** Present while this turn's deletion question is still unanswered. */
  onConfirm?: (yes: boolean) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="ml-auto w-fit max-w-[85%] rounded-[18px] rounded-br-md bg-accent-fill px-3.5 py-2 text-[15px] leading-snug text-white">
        {turn.said}
      </p>
      {turn.reply && <p className="max-w-[92%] text-[15px] leading-snug">{turn.reply}</p>}
      {turn.error && <p className="max-w-[92%] text-[14px] leading-snug text-danger">{turn.error}</p>}
      {onConfirm && (
        <div className="flex gap-2" role="group" aria-label="Confirm deletion">
          <button
            type="button"
            onClick={() => onConfirm(true)}
            className="pressable min-h-11 flex-1 rounded-full bg-danger-fill px-4 text-[15px] font-semibold text-white"
          >
            Delete
          </button>
          <button
            type="button"
            onClick={() => onConfirm(false)}
            className="pressable min-h-11 flex-1 rounded-full bg-fill px-4 text-[15px] font-semibold text-label"
          >
            Keep
          </button>
        </div>
      )}
      {turn.changes && turn.changes.length > 0 && (
        <ul className="overflow-hidden rounded-xl bg-surface/70 text-[14px]" aria-label="Changes made">
          {turn.changes.map((c, i) => (
            <li key={`${c.taskId}-${i}`} className={i > 0 ? "border-t border-separator" : ""}>
              {c.kind === "deleted" ? (
                <div className="flex min-h-11 items-center gap-2 px-3 py-2 text-label-2">
                  <span className="font-medium">{CHANGE_VERB[c.kind]}</span>
                  <span className="min-w-0 flex-1 truncate line-through">{c.title}</span>
                  {c.count && c.count > 1 ? <span className="shrink-0">+{c.count - 1} sub</span> : null}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void revealTask(c.taskId, c.date, today)}
                  className="flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left hover:bg-fill"
                >
                  <span className="font-medium text-accent">{CHANGE_VERB[c.kind]}</span>
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="tabular shrink-0 text-[12px] text-label-2">{dayLabel(c.date)}</span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
