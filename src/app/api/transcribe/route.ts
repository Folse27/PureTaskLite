import { z } from "zod";
import { GroqError, transcribe } from "@/lib/ai/groq";
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
    const text = await transcribe(audio, filenameFor(audio.type));
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
