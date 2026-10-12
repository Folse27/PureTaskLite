import { z } from "zod";
import { GroqError, transcribe } from "@/lib/ai/groq";
import { snapshotWindow } from "@/lib/ai/snapshot";
import { buildWhisperPrompt } from "@/lib/ai/stt";
import { todayISO } from "@/lib/dates";
import { listLabels } from "@/lib/server/labels";
import { listTasks } from "@/lib/server/tasks";
import { HttpError, route } from "@/lib/server/http";

export const maxDuration = 60;

/** Vercel functions accept request bodies up to 4.5 MB. */
const MAX_BYTES = 4 * 1024 * 1024;

const audioFile = z
  .instanceof(Blob, { message: "Missing audio." })
  .refine((f) => f.size > 0, "The recording is empty.")
  .refine((f) => f.size <= MAX_BYTES, "The recording is too long.")
  .refine((f) => /^(audio|video)\//.test(f.type) || f.type === "", "Unsupported audio format.");

/** Maps the recorder's MIME type to a filename extension Groq recognises. */
function filenameFor(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("mp4") || t.includes("m4a") || t.includes("aac")) return "audio.mp4"; // iOS Safari
  if (t.includes("ogg")) return "audio.ogg";
  if (t.includes("wav")) return "audio.wav";
  if (t.includes("mpeg") || t.includes("mp3")) return "audio.mp3";
  return "audio.webm"; // Chrome / Firefox
}

/** Planner words plus your status/priority names and nearby task titles, as context for Whisper. */
async function vocabularyPrompt(): Promise<string> {
  try {
    const window = snapshotWindow(todayISO());
    const [statuses, priorities, tasks] = await Promise.all([
      listLabels("statuses"),
      listLabels("priorities"),
      listTasks(window.from, window.to),
    ]);
    // Most recently edited first, so the words you're likely to say come first.
    const titles = [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((t) => t.title);
    return buildWhisperPrompt({
      statuses: statuses.map((l) => l.name),
      priorities: priorities.map((l) => l.name),
      titles,
    });
  } catch (error) {
    console.error("[transcribe] Couldn't build the vocabulary prompt; transcribing without it:", error);
    return "";
  }
}

/** POST multipart/form-data { audio } → { text } */
export const POST = route(async (request) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "Expected multipart form data.");
  }
  const audio = audioFile.parse(form.get("audio"));
  try {
    const text = await transcribe(audio, filenameFor(audio.type), await vocabularyPrompt());
    return Response.json({ text });
  } catch (error) {
    if (error instanceof GroqError) {
      return Response.json(
        { error: error.userMessage, retryAfterSeconds: error.retryAfterSeconds },
        { status: error.status },
      );
    }
    throw error;
  }
});
