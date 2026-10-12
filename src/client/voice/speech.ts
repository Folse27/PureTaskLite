"use client";

/** Text-to-speech with the browser's built-in speechSynthesis (free, on-device). */

const supported = () => typeof window !== "undefined" && "speechSynthesis" in window;

let unlocked = false;
let chosen: SpeechSynthesisVoice | null = null;

/** Preference order for natural-sounding English voices across platforms. */
const PREFERRED = [
  /siri/i,
  /\b(premium|enhanced)\b/i,
  /natural|neural|online/i, // Microsoft Edge "… Online (Natural)" voices
  /^(ava|samantha|allison|susan|zoe|evan|nathan|tom)\b/i, // Apple
  /google (us|uk) english/i, // Chrome
  /(aria|jenny|guy|libby|sonia|ryan)/i, // Microsoft
  /^(daniel|karen|moira|serena|tessa|fiona)\b/i,
];

function score(v: SpeechSynthesisVoice): number {
  if (!/^en(-|_|$)/i.test(v.lang)) return -1;
  let s = 0;
  PREFERRED.forEach((re, i) => {
    if (re.test(v.name)) s = Math.max(s, 100 - i * 10);
  });
  if (/en[-_](US|GB)/i.test(v.lang)) s += 5;
  if (v.default) s += 1;
  if (/compact|eloquence|novelty|bad news|bells|bubbles|cellos|whisper|zarvox|trinoids|albert|jester|organ|superstar|wobble/i.test(v.name)) {
    s -= 200;
  }
  return s;
}

function pickVoice() {
  if (!supported()) return;
  const voices = window.speechSynthesis.getVoices();
  chosen = voices.filter((v) => score(v) >= 0).sort((a, b) => score(b) - score(a))[0] ?? null;
}

if (supported()) {
  pickVoice();
  window.speechSynthesis.addEventListener?.("voiceschanged", pickVoice);
}

/**
 * iOS only lets speech start from a user gesture. Speaking a silent utterance
 * during the first tap unlocks it for later (async) replies.
 */
export function unlockSpeech() {
  if (unlocked || !supported()) return;
  unlocked = true;
  const u = new SpeechSynthesisUtterance(" ");
  u.volume = 0;
  window.speechSynthesis.speak(u);
}

export function speak(text: string) {
  if (!supported() || !text.trim()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  if (!chosen) pickVoice();
  const u = new SpeechSynthesisUtterance(text);
  if (chosen) u.voice = chosen;
  u.lang = chosen?.lang ?? "en-US";
  u.rate = 1.02;
  u.pitch = 1;
  // Chrome occasionally stays paused after cancel(); resume is harmless elsewhere.
  synth.resume();
  synth.speak(u);
}

export function stopSpeaking() {
  if (supported()) window.speechSynthesis.cancel();
}
