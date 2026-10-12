import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chatCompletion, GroqError, retryAfterSeconds, transcribe } from "./groq";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const limited = (message: string, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error: { message, code: "rate_limit_exceeded" } }), { status: 429, headers });
const completion = () => ok({ choices: [{ message: { role: "assistant", content: "Hi." }, finish_reason: "stop" }] });

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

describe("chatCompletion rate-limit handling", () => {
  it("waits and retries when Groq says how long to wait", async () => {
    fetchMock.mockResolvedValueOnce(limited("Please try again in 10ms.")).mockResolvedValueOnce(completion());
    const result = await chatCompletion({ messages: [], tools: [] });
    expect(result.message.content).toBe("Hi.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up when the wait doesn't fit the time budget", async () => {
    fetchMock.mockResolvedValue(limited("Please try again in 40s."));
    await expect(chatCompletion({ messages: [], tools: [], deadline: Date.now() + 5_000 })).rejects.toMatchObject({
      status: 429,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends low reasoning effort and a small token cap for gpt-oss", async () => {
    fetchMock.mockResolvedValueOnce(completion());
    await chatCompletion({ messages: [], tools: [] });
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(payload).toMatchObject({ reasoning_effort: "low", max_completion_tokens: 1024, parallel_tool_calls: true });
  });

  it("does not retry other errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "boom" } }), { status: 500 }));
    await expect(chatCompletion({ messages: [], tools: [] })).rejects.toBeInstanceOf(GroqError);
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

  it("can be switched to auto-detect", async () => {
    vi.stubEnv("GROQ_STT_LANGUAGE", "auto");
    fetchMock.mockResolvedValueOnce(ok({ text: "Hallo" }));
    await transcribe(new Blob(["x"], { type: "audio/webm" }), "audio.webm");
    expect(sentLanguage()).toBeNull();
  });
});
