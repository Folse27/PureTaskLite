"use client";

import { create } from "zustand";
import type { AssistantChange, ChatMessage } from "@/lib/types";
import { api, ApiError } from "../api";
import { usePlanner } from "../planner-store";
import { canRecognize, canRecord, MAX_RECORDING_MS, MicError, recognizeSpeech, Recorder } from "./recorder";
import { speak, stopSpeaking, unlockSpeech } from "./speech";

export type Phase = "idle" | "recording" | "listening" | "transcribing" | "thinking";

export interface Turn {
  id: number;
  said: string;
  reply?: string;
  changes?: AssistantChange[];
  error?: string;
}

interface AssistantState {
  open: boolean;
  phase: Phase;
  /** When recording started (performance.now()), for the live duration. */
  startedAt: number;
  /** Live transcript while using on-device recognition. */
  interim: string;
  turns: Turn[];
  history: ChatMessage[];
  /** Friendly status/error line shown above the input. */
  notice: string | null;
  /** Use the Web Speech API for the next capture (after a failed upload). */
  useFallback: boolean;
  muted: boolean;

  setOpen: (open: boolean) => void;
  toggleMic: () => Promise<void>;
  send: (text: string) => Promise<void>;
  reset: () => void;
  setMuted: (muted: boolean) => void;
}

const SESSION_KEY = "ptl-assistant-v1";
const MUTED_KEY = "ptl-assistant-muted";
const recorder = new Recorder();
let recognition: { stop: () => void } | null = null;
let autoStop: ReturnType<typeof setTimeout> | undefined;
let turnId = 0;

function loadSession(): Pick<AssistantState, "turns" | "history"> {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Pick<AssistantState, "turns" | "history">;
      turnId = parsed.turns.reduce((m, t) => Math.max(m, t.id), 0);
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return { turns: [], history: [] };
}

function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === "1";
  } catch {
    return false;
  }
}

export const useAssistant = create<AssistantState>((set, get) => {
  const say = (text: string) => {
    if (!get().muted) speak(text);
  };
  const notify = (notice: string, spoken?: string) => {
    set({ notice });
    if (spoken) say(spoken);
  };

  const micProblem = (error: unknown) => {
    const kind = error instanceof MicError ? error.kind : "failed";
    set({ phase: "idle", open: true });
    if (kind === "denied") {
      notify(
        "Microphone access is blocked. Allow it for this site in your browser settings, or type below.",
        "I can't access the microphone.",
      );
    } else if (kind === "no-device") {
      notify("No microphone was found. You can type your request below.", "I couldn't find a microphone.");
    } else if (kind === "unsupported") {
      notify("Voice input isn't supported in this browser. You can type your request below.");
    } else {
      notify("The microphone couldn't start. Please try again.", "The microphone couldn't start.");
    }
  };

  async function transcribeAndSend(blob: Blob, durationMs: number) {
    if (durationMs < 600 || blob.size < 1200) {
      set({ phase: "idle" });
      notify("That was very short — tap the mic, speak, then tap again.");
      return;
    }
    set({ phase: "transcribing", notice: null });
    const form = new FormData();
    form.append("audio", blob, "recording");
    try {
      const { text } = await api<{ text: string }>("/api/transcribe", { form });
      if (!text.trim()) {
        set({ phase: "idle" });
        notify("I didn’t catch that. Please try again a little closer to the mic.", "Sorry, I didn't catch that.");
        return;
      }
      await get().send(text);
    } catch (error) {
      set({ phase: "idle" });
      if (error instanceof ApiError && error.status === 429) {
        notify(error.message, "I'm busy right now. Please try again in a moment.");
      } else if (canRecognize()) {
        set({ useFallback: true });
        notify(
          "Server transcription didn’t work. Tap the mic and say it again — I’ll use your browser’s speech recognition.",
          "Please say that again.",
        );
      } else {
        notify(
          error instanceof ApiError ? error.message : "Transcription failed. Please try again.",
          "Sorry, that didn't work.",
        );
      }
    }
  }

  async function startFallback() {
    set({ phase: "listening", interim: "", notice: null, open: true });
    const session = recognizeSpeech((text) => set({ interim: text }));
    recognition = session;
    try {
      const text = await session.result;
      recognition = null;
      set({ phase: "idle", interim: "", useFallback: false });
      if (!text) {
        notify("I didn’t catch that. Please try again.", "Sorry, I didn't catch that.");
        return;
      }
      await get().send(text);
    } catch (error) {
      recognition = null;
      set({ interim: "", useFallback: false });
      micProblem(error);
    }
  }

  return {
    open: false,
    phase: "idle",
    startedAt: 0,
    interim: "",
    turns: [],
    history: [],
    notice: null,
    useFallback: false,
    muted: false,

    setOpen: (open) => {
      set({ open });
      if (!open) stopSpeaking();
    },

    toggleMic: async () => {
      stopSpeaking();
      unlockSpeech();
      const { phase } = get();

      if (phase === "recording") {
        clearTimeout(autoStop);
        const { blob, durationMs } = await recorder.stop();
        await transcribeAndSend(blob, durationMs);
        return;
      }
      if (phase === "listening") {
        recognition?.stop();
        return;
      }
      if (phase !== "idle") return;

      if ((get().useFallback || !canRecord()) && canRecognize()) {
        await startFallback();
        return;
      }
      set({ open: true, notice: null });
      try {
        await recorder.start();
        set({ phase: "recording", startedAt: recorder.startedAt });
        autoStop = setTimeout(() => {
          if (get().phase === "recording") void get().toggleMic();
        }, MAX_RECORDING_MS);
      } catch (error) {
        micProblem(error);
      }
    },

    send: async (text) => {
      const said = text.trim();
      if (!said || get().phase === "thinking") return;
      const id = ++turnId;
      set((s) => ({ phase: "thinking", notice: null, open: true, turns: [...s.turns, { id, said }] }));
      try {
        const result = await api<{ reply: string; changes: AssistantChange[]; history: ChatMessage[] }>(
          "/api/assistant",
          { body: { text: said, history: get().history } },
        );
        set((s) => ({
          phase: "idle",
          history: result.history,
          turns: s.turns.map((t) => (t.id === id ? { ...t, reply: result.reply, changes: result.changes } : t)),
        }));
        say(result.reply);
        // Show the AI's changes in the tree right away.
        if (result.changes.length > 0) void usePlanner.getState().refresh();
      } catch (error) {
        const message = error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
        set((s) => ({ phase: "idle", turns: s.turns.map((t) => (t.id === id ? { ...t, error: message } : t)) }));
        say(
          error instanceof ApiError && error.status === 429
            ? "I'm busy right now. Please try again in a moment."
            : "Sorry, something went wrong.",
        );
      }
    },

    reset: () => {
      stopSpeaking();
      set({ turns: [], history: [], notice: null });
    },

    setMuted: (muted) => {
      if (muted) stopSpeaking();
      try {
        localStorage.setItem(MUTED_KEY, muted ? "1" : "0");
      } catch {
        /* ignore */
      }
      set({ muted });
    },
  };
});

/** Restore this tab's conversation and the mute preference (client-only). Returns an unsubscribe. */
export function hydrateAssistant(): () => void {
  useAssistant.setState({ ...loadSession(), muted: loadMuted() });
  return useAssistant.subscribe((s, prev) => {
    if (s.turns === prev.turns && s.history === prev.history) return;
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ turns: s.turns.slice(-30), history: s.history }));
    } catch {
      /* ignore */
    }
  });
}
