import "server-only";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
const MODELS_DOC = "https://console.groq.com/docs/models";

export const chatModel = () => process.env.GROQ_CHAT_MODEL?.trim() || "openai/gpt-oss-120b";
export const sttModel = () => process.env.GROQ_STT_MODEL?.trim() || "whisper-large-v3-turbo";
/**
 * Spoken language for Whisper (ISO-639-1). Defaults to English: auto-detection
 * misfires on short clips (e.g. "Can you hear me?" came back as Icelandic).
 * Set GROQ_STT_LANGUAGE=auto to let Whisper detect it.
 */
export const sttLanguage = () => {
  const value = process.env.GROQ_STT_LANGUAGE?.trim().toLowerCase();
  if (value === "auto") return null;
  return value || "en";
};

/** How long we're willing to wait in total for Groq rate limits within one request. */
const DEFAULT_RATE_LIMIT_BUDGET_MS = 25_000;

/** Error with a message that is safe (and friendly) to show and speak to the user. */
export class GroqError extends Error {
  constructor(
    readonly status: number,
    readonly userMessage: string,
    detail: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(detail);
    this.name = "GroqError";
  }
}

function apiKey(): string {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) {
    console.error("[groq] GROQ_API_KEY is not set. Create a free key at https://console.groq.com/keys.");
    throw new GroqError(503, "The voice assistant isn't set up yet.", "GROQ_API_KEY missing");
  }
  return key;
}

async function toGroqError(response: Response, model: string, envVar: string): Promise<GroqError> {
  let message = response.statusText;
  let code = "";
  try {
    const body = (await response.json()) as { error?: { message?: string; code?: string } };
    message = body.error?.message ?? message;
    code = body.error?.code ?? "";
  } catch {
    /* non-JSON error body */
  }

  const modelProblem =
    code === "model_not_found" ||
    code === "model_decommissioned" ||
    /model.*(not found|does not exist|decommissioned|deprecated|no longer supported)/i.test(message);
  if (modelProblem) {
    console.error(
      `[groq] Model "${model}" is not available on Groq (${message}). ` +
        `Update the ${envVar} environment variable to a current model ID from ${MODELS_DOC} and redeploy.`,
    );
    return new GroqError(502, "The AI model needs updating in the app settings.", message);
  }
  if (response.status === 429) {
    // Log Groq's exact wording so the Vercel logs show which limit was hit (tokens/requests per minute/day).
    console.warn(`[groq] Rate limited (${model}): ${message}`);
    return new GroqError(
      429,
      "The assistant is busy right now. Please try again in a moment.",
      message,
      retryAfterSeconds(response.headers.get("retry-after"), message),
    );
  }
  if (response.status === 401 || response.status === 403) {
    console.error(`[groq] Authentication failed (${message}). Check the GROQ_API_KEY environment variable.`);
    return new GroqError(503, "The voice assistant isn't set up correctly.", message);
  }
  if (response.status === 413) {
    return new GroqError(413, "That recording was too long. Please keep it shorter.", message);
  }
  console.error(`[groq] ${response.status} from Groq (${model}): ${message}`);
  return new GroqError(502, "The assistant had a problem. Please try again.", message);
}

/**
 * Seconds to wait before retrying, from the Retry-After header or Groq's message
 * ("Please try again in 2.86s" / "in 1m3.5s").
 */
export function retryAfterSeconds(header: string | null, message: string): number | undefined {
  const fromHeader = Number(header);
  if (header && Number.isFinite(fromHeader) && fromHeader > 0) return fromHeader;
  const match = /try again in (?:(\d+)m)?([\d.]+)(ms|s)/i.exec(message);
  if (!match) return undefined;
  const minutes = Number(match[1] ?? 0);
  const value = Number(match[2]);
  const seconds = minutes * 60 + (match[3].toLowerCase() === "ms" ? value / 1000 : value);
  return seconds > 0 ? seconds : undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Absolute time (ms since epoch) after which we stop waiting out rate limits. */
export type Deadline = number;

async function groqFetch(
  path: string,
  init: RequestInit,
  model: string,
  envVar: string,
  deadline: Deadline = Date.now() + DEFAULT_RATE_LIMIT_BUDGET_MS,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${GROQ_BASE_URL}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${apiKey()}`, ...init.headers },
        signal: AbortSignal.timeout(45_000),
      });
    } catch (error) {
      if (error instanceof GroqError) throw error;
      console.error("[groq] Network error:", error);
      throw new GroqError(504, "I couldn't reach the assistant. Please try again.", String(error));
    }
    if (response.ok) return response;

    const error = await toGroqError(response, model, envVar);
    // Free-tier limits are per minute: wait it out if Groq says how long and it fits the budget.
    const waitMs = error.status === 429 && error.retryAfterSeconds ? error.retryAfterSeconds * 1000 + 250 : null;
    if (waitMs === null || attempt >= 3 || Date.now() + waitMs > deadline) throw error;
    console.warn(`[groq] Waiting ${(waitMs / 1000).toFixed(1)}s before retrying (attempt ${attempt + 2}).`);
    await sleep(waitMs);
  }
}

interface VerboseTranscription {
  text: string;
  segments?: { text: string; no_speech_prob?: number }[];
}

/** Speech-to-text. Returns "" when nothing intelligible was said. */
export async function transcribe(audio: Blob, filename: string): Promise<string> {
  const model = sttModel();
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("model", model);
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");
  const language = sttLanguage();
  if (language) form.append("language", language);

  const response = await groqFetch("/audio/transcriptions", { method: "POST", body: form }, model, "GROQ_STT_MODEL");
  const result = (await response.json()) as VerboseTranscription;

  // Whisper tends to "hear" things like "Thank you." in silence; drop segments it flags as non-speech.
  const segments = result.segments ?? [];
  if (segments.length > 0) {
    return segments
      .filter((s) => (s.no_speech_prob ?? 0) < 0.7)
      .map((s) => s.text)
      .join("")
      .trim();
  }
  return (result.text ?? "").trim();
}

export type ChatRole = "system" | "user" | "assistant";

/**
 * One chat completion whose answer must be a JSON object matching `schema`.
 * Uses strict structured outputs; if the configured model doesn't support them,
 * falls back to plain JSON mode (the caller validates the result either way).
 */
export async function chatJson(body: {
  messages: { role: ChatRole; content: string }[];
  schema: object;
  /** Stop waiting out rate limits after this time. */
  deadline?: Deadline;
}): Promise<unknown> {
  const model = chatModel();
  const base: Record<string, unknown> = {
    model,
    messages: body.messages,
    temperature: 0.2,
    // Room for a large operations table; the free tier allows ~8K tokens per minute in total.
    max_completion_tokens: 3000,
  };
  if (model.startsWith("openai/gpt-oss")) base.reasoning_effort = "low";

  const send = (responseFormat: object) =>
    groqFetch(
      "/chat/completions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...base, response_format: responseFormat }),
      },
      model,
      "GROQ_CHAT_MODEL",
      body.deadline,
    );

  let response: Response;
  try {
    response = await send({
      type: "json_schema",
      json_schema: { name: "planner_response", strict: true, schema: body.schema },
    });
  } catch (error) {
    const unsupported =
      error instanceof GroqError &&
      error.status === 502 &&
      /response_format|json_schema|structured|strict|json_validate_failed|failed to (generate|validate) json/i.test(error.message);
    if (!unsupported) throw error;
    console.warn(`[groq] ${model} doesn't support strict structured outputs; using JSON mode instead.`);
    response = await send({ type: "json_object" });
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  };
  const choice = data.choices?.[0];
  if (choice?.finish_reason === "length") {
    throw new GroqError(502, "That was a lot at once. Please split it into smaller requests.", "Output truncated");
  }
  try {
    return JSON.parse(choice?.message?.content ?? "");
  } catch {
    console.error("[groq] The model returned invalid JSON:", choice?.message?.content?.slice(0, 500));
    throw new GroqError(502, "I got confused by that one. Please try again.", "Invalid JSON from model");
  }
}
