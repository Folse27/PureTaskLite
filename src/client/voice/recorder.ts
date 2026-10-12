"use client";

/** Tap-to-start / tap-to-stop audio recording with MediaRecorder. */

export const MAX_RECORDING_MS = 120_000;

/** Chrome/Firefox/Android record WebM/Opus; iOS Safari records MP4/AAC. */
const CANDIDATE_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

export function canRecord(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

function pickMimeType(): string | undefined {
  return CANDIDATE_TYPES.find((t) => {
    try {
      return MediaRecorder.isTypeSupported(t);
    } catch {
      return false;
    }
  });
}

export type MicErrorKind = "denied" | "no-device" | "unsupported" | "failed";

export class MicError extends Error {
  constructor(readonly kind: MicErrorKind) {
    super(kind);
  }
}

export class Recorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private stopped: Promise<Blob> | null = null;
  startedAt = 0;

  async start(): Promise<void> {
    if (!canRecord()) throw new MicError("unsupported");
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
    } catch (error) {
      const name = (error as DOMException)?.name;
      if (name === "NotAllowedError" || name === "SecurityError") throw new MicError("denied");
      if (name === "NotFoundError" || name === "OverconstrainedError") throw new MicError("no-device");
      throw new MicError("failed");
    }

    const mimeType = pickMimeType();
    try {
      this.recorder = new MediaRecorder(this.stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 48_000,
      });
    } catch {
      this.release();
      throw new MicError("unsupported");
    }

    this.chunks = [];
    const recorder = this.recorder;
    this.stopped = new Promise<Blob>((resolve) => {
      recorder.addEventListener("dataavailable", (e) => {
        if (e.data.size > 0) this.chunks.push(e.data);
      });
      recorder.addEventListener("stop", () => {
        const type = (recorder.mimeType || mimeType || "audio/webm").split(";")[0];
        resolve(new Blob(this.chunks, { type }));
        this.release();
      });
    });
    // A timeslice makes Safari deliver data reliably.
    recorder.start(1000);
    this.startedAt = performance.now();
  }

  /** Stops and returns the recording. */
  async stop(): Promise<{ blob: Blob; durationMs: number }> {
    const durationMs = performance.now() - this.startedAt;
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    const blob = this.stopped ? await this.stopped : new Blob();
    this.recorder = null;
    this.stopped = null;
    return { blob, durationMs };
  }

  cancel() {
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.recorder = null;
    this.release();
  }

  private release() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

/* ── Web Speech API fallback (on-device recognition) ───────────────────── */

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const canRecognize = () => recognitionCtor() !== null;

/** Listens until the user stops talking (or `stop()` is called) and resolves with the transcript. */
export function recognizeSpeech(onInterim: (text: string) => void): { result: Promise<string>; stop: () => void } {
  const Ctor = recognitionCtor();
  if (!Ctor) return { result: Promise.reject(new MicError("unsupported")), stop: () => {} };
  const rec = new Ctor();
  rec.lang = "en-US";
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;

  let finalText = "";
  let interim = "";
  const result = new Promise<string>((resolve, reject) => {
    rec.onresult = (e) => {
      interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      onInterim((finalText + interim).trim());
    };
    rec.onerror = (e) => {
      if (e.error === "no-speech" || e.error === "aborted") return;
      reject(new MicError(e.error === "not-allowed" || e.error === "service-not-allowed" ? "denied" : "failed"));
    };
    rec.onend = () => resolve((finalText || interim).trim());
  });
  rec.start();
  return { result, stop: () => rec.stop() };
}
