import { describe, expect, it } from "vitest";
import { buildWhisperPrompt, isPromptEcho, isSilentSegment, transcriptFrom } from "./stt";

describe("silence filtering", () => {
  it("keeps quiet but confident speech", () => {
    // Previously dropped: high no-speech probability alone isn't enough.
    expect(isSilentSegment({ text: " add milk", no_speech_prob: 0.75, avg_logprob: -0.3 })).toBe(false);
  });

  it("drops segments that are probably silence and low-confidence", () => {
    expect(isSilentSegment({ text: " Thank you.", no_speech_prob: 0.9, avg_logprob: -1.4 })).toBe(true);
  });

  it("joins the kept segments", () => {
    expect(
      transcriptFrom({
        segments: [
          { text: " Add milk", no_speech_prob: 0.1, avg_logprob: -0.2 },
          { text: " tomorrow.", no_speech_prob: 0.7, avg_logprob: -0.4 },
          { text: " Thank you.", no_speech_prob: 0.95, avg_logprob: -1.6 },
        ],
      }),
    ).toBe("Add milk tomorrow.");
    expect(transcriptFrom({ text: " Hello " })).toBe("Hello");
  });
});

describe("prompt echo", () => {
  const prompt = buildWhisperPrompt({ statuses: ["To do"], priorities: ["High"], titles: ["Book dentist appointment"] });

  it("treats a transcript that just repeats the prompt as silence", () => {
    expect(isPromptEcho("Add a sub-note, move it to next Friday.", prompt)).toBe(true);
    expect(transcriptFrom({ text: "Mark it as done, set the priority to high." }, prompt)).toBe("");
  });

  it("keeps real requests, even short ones that use prompt words", () => {
    expect(isPromptEcho("Move the dentist appointment to Friday", prompt)).toBe(false);
    expect(isPromptEcho("Yes.", prompt)).toBe(false);
  });
});

describe("buildWhisperPrompt", () => {
  it("includes planner words, labels and task titles", () => {
    const prompt = buildWhisperPrompt({
      statuses: ["To do", "In progress"],
      priorities: ["Urgent"],
      titles: ["Book dentist appointment", "Book dentist appointment", " Report to client "],
    });
    expect(prompt).toContain("sub-note");
    expect(prompt).toContain("Statuses and priorities: To do, In progress, Urgent.");
    expect(prompt).toContain("Tasks: Book dentist appointment, Report to client.");
  });

  it("stays within Whisper's prompt limit", () => {
    const titles = Array.from({ length: 200 }, (_, i) => `Some fairly long task title number ${i}`);
    const prompt = buildWhisperPrompt({ statuses: [], priorities: [], titles });
    expect(prompt.length).toBeLessThanOrEqual(700);
    expect(prompt.endsWith(".")).toBe(true);
  });
});
