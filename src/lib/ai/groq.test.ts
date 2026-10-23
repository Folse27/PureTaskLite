import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatJson, GroqError, retryAfterSeconds, transcribe } from "./groq";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const limited = (message: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { message, code: "rate_limit_exceeded" } }), { status: 429, headers });
const completion = (content = '{"reply":"Hi."}', finish_reason = "stop") =>
  ok({ choices: [{ message: { role: "assistant", content }, finish_reason }] });
const ask = (deadline?: number) =>
  chatJson({ messages: [{ role: "user", content: "hi" }], schema: { type: "object" }, deadline });

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GROQ_API_KEY", "gsk_test");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  fetchMock.mockReset();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("retryAfterSeconds", () => {
  it("reads the Retry-After header", () => {
    expect(retryAfterSeconds("7", "")).toBe(7);
  });
  it("parses Groq's message", () => {
    expect(retryAfterSeconds(null, "Please try again in 2.86s. Need more tokens?")).toBeCloseTo(2.86);
    expect(retryAfterSeconds(null, "Please try again in 1m3.5s.")).toBeCloseTo(63.5);
    expect(retryAfterSeconds(null, "Please try again in 450ms.")).toBeCloseTo(0.45);
    expect(retryAfterSeconds(null, "Rate limit reached.")).toBeUndefined();
  });
});

describe("chatJson", () => {
  const sent = (call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body);

  it("asks for strict structured output with low reasoning effort", async () => {
    fetchMock.mockResolvedValueOnce(completion());
    expect(await ask()).toEqual({ reply: "Hi." });
    expect(sent()).toMatchObject({
      reasoning_effort: "low",
      response_format: { type: "json_schema", json_schema: { name: "planner_response", strict: true } },
    });
    expect(sent()).not.toHaveProperty("tools");
  });

  it("falls back to JSON mode when the model doesn't support strict outputs", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: "response_format json_schema is not supported by this model" } }),
          {
            status: 400,
          },
        ),
      )
      .mockResolvedValueOnce(completion());
    expect(await ask()).toEqual({ reply: "Hi." });
    expect(sent(1).response_format).toEqual({ type: "json_object" });
  });

  it("waits and retries when Groq says how long to wait", async () => {
    fetchMock.mockResolvedValueOnce(limited("Please try again in 10ms.")).mockResolvedValueOnce(completion());
    expect(await ask()).toEqual({ reply: "Hi." });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up when the wait doesn't fit the time budget", async () => {
    fetchMock.mockResolvedValue(limited("Please try again in 40s."));
    await expect(ask(Date.now() + 5_000)).rejects.toMatchObject({ status: 429 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports truncated and invalid output clearly", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(completion('{"reply":"Hi', "length"));
    await expect(ask()).rejects.toMatchObject({ userMessage: expect.stringMatching(/split it/) });
    fetchMock.mockResolvedValueOnce(completion("not json"));
    await expect(ask()).rejects.toBeInstanceOf(GroqError);
  });

  it("does not retry other errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 }));
    await expect(ask()).rejects.toBeInstanceOf(GroqError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("transcribe language", () => {
  const sentLanguage = () => (fetchMock.mock.calls[0][1].body as FormData).get("language");

  it("defaults to English", async () => {
    fetchMock.mockResolvedValueOnce(ok({ text: "Can you hear me?" }));
    await transcribe(new Blob(["x"], { type: "audio/mp4" }), "audio.mp4");
    expect(sentLanguage()).toBe("en");
  });

  it("sends the vocabulary prompt and uses whisper-large-v3 by default", async () => {
    fetchMock.mockResolvedValueOnce(ok({ text: "Move the dentist appointment to Friday" }));
    const text = await transcribe(
      new Blob(["x"], { type: "audio/mp4" }),
      "audio.mp4",
      "Tasks: Book dentist appointment.",
    );
    const form = fetchMock.mock.calls[0][1].body as FormData;
    expect(form.get("prompt")).toBe("Tasks: Book dentist appointment.");
    expect(form.get("model")).toBe("whisper-large-v3");
    expect(text).toBe("Move the dentist appointment to Friday");
  });

  it("can be switched to auto-detect", async () => {
    vi.stubEnv("GROQ_STT_LANGUAGE", "auto");
    fetchMock.mockResolvedValueOnce(ok({ text: "Hallo" }));
    await transcribe(new Blob(["x"], { type: "audio/webm" }), "audio.webm");
    expect(sentLanguage()).toBeNull();
  });
});
