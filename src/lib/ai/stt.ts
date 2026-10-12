/** Speech-to-text helpers for Whisper (pure, unit-tested). */

export interface WhisperSegment {
  text: string;
  no_speech_prob?: number;
  avg_logprob?: number;
}

export interface WhisperResult {
  text?: string;
  segments?: WhisperSegment[];
}

/**
 * Whisper's own silence rule: a segment counts as silence only if it is
 * probably not speech AND the model wasn't confident about the words. Checking
 * no_speech_prob alone throws away real (quiet) speech.
 */
export function isSilentSegment(s: WhisperSegment): boolean {
  return (s.no_speech_prob ?? 0) > 0.6 && (s.avg_logprob ?? 0) < -1;
}

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * On silence Whisper sometimes "transcribes" its prompt. Treat a transcript
 * that is just a piece of the prompt as nothing said.
 */
export function isPromptEcho(transcript: string, prompt: string): boolean {
  const t = normalize(transcript);
  return t.length >= 12 && normalize(prompt).includes(t);
}

export function transcriptFrom(result: WhisperResult, prompt = ""): string {
  const segments = result.segments ?? [];
  const text = (segments.length > 0 ? segments.filter((s) => !isSilentSegment(s)).map((s) => s.text).join("") : (result.text ?? "")).trim();
  return prompt && isPromptEcho(text, prompt) ? "" : text;
}

const MAX_PROMPT_CHARS = 700; // Whisper reads at most ~224 tokens of prompt

/**
 * A short prompt in the user's domain: Whisper uses it as context, so it spells
 * task names and planner words correctly ("dentist appointment", "sub-note", "Urgent").
 */
export function buildWhisperPrompt(input: { statuses: string[]; priorities: string[]; titles: string[] }): string {
  let prompt =
    "Planner voice commands, e.g. add a task for tomorrow, add a sub-note, move it to next Friday, mark it as done, set the priority to high, what did I do in June?";
  const labels = [...input.statuses, ...input.priorities].filter(Boolean);
  if (labels.length) prompt += ` Statuses and priorities: ${labels.join(", ")}.`;
  const titles = [...new Set(input.titles.map((t) => t.trim()).filter(Boolean))];
  if (titles.length) {
    let list = "";
    for (const title of titles) {
      const next = list ? `${list}, ${title}` : title;
      if (prompt.length + " Tasks: ".length + next.length + 1 > MAX_PROMPT_CHARS) break;
      list = next;
    }
    if (list) prompt += ` Tasks: ${list}.`;
  }
  return prompt;
}
