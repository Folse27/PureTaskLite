import { addMonths, endOfMonth, format, startOfMonth } from "date-fns";
import { fromISODate, toISODate } from "@/lib/dates";

/**
 * Finds months the user mentions ("June 2026", "in March", "last month") so
 * the server can hand the model those months' tasks up front. Questions like
 * "What did I do in June?" are then answered in one call, without a lookup.
 */

export interface DateRange {
  from: string;
  to: string;
  /** "June 2026" */
  label: string;
}

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];
const ABBREVIATIONS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};
/** Month names that are also everyday words; only count them with a clear date context. */
const AMBIGUOUS = new Set(["may", "march"]);
const DATE_CONTEXT_BEFORE =
  /\b(in|on|of|during|from|until|till|through|since|for|by|before|after|last|next|this|early|mid|late|end of|start of|beginning of|\d{1,2}(st|nd|rd|th)?)\s*$/;

function monthRange(year: number, monthIndex: number): DateRange {
  const start = new Date(year, monthIndex, 1);
  return {
    from: toISODate(startOfMonth(start)),
    to: toISODate(endOfMonth(start)),
    label: format(start, "MMMM yyyy"),
  };
}

export function findMentionedRanges(text: string, today: string, max = 3): DateRange[] {
  const lower = text.toLowerCase();
  const now = fromISODate(today);
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const ranges: DateRange[] = [];
  const add = (r: DateRange) => {
    if (!ranges.some((x) => x.from === r.from)) ranges.push(r);
  };

  // "last month", "this month", "next month"
  for (const m of lower.matchAll(/\b(last|previous|past|this|current|next|coming)\s+month\b/g)) {
    const offset = /last|previous|past/.test(m[1]) ? -1 : /next|coming/.test(m[1]) ? 1 : 0;
    const d = addMonths(startOfMonth(now), offset);
    add(monthRange(d.getFullYear(), d.getMonth()));
  }

  // Month names, optionally with a year: "June", "June 2026", "June, 2026", "June of 2026", "last June"
  const names = [...MONTHS, ...Object.keys(ABBREVIATIONS)].sort((a, b) => b.length - a.length).join("|");
  const re = new RegExp(`\\b(${names})\\b\\.?(?:\\s*,?\\s*(?:of\\s+)?(\\d{4})\\b)?`, "g");
  for (const m of lower.matchAll(re)) {
    const word = m[1];
    const year = m[2] ? Number(m[2]) : undefined;
    const before = lower.slice(0, m.index);
    const after = lower.slice(m.index! + m[0].length);
    const followedByDay = /^\s*\d{1,2}(st|nd|rd|th)?\b/.test(after);
    const isFull = MONTHS.includes(word);
    // Abbreviations and words like "may"/"march" need a year, a day number or a date-ish word before them.
    if ((!isFull || AMBIGUOUS.has(word)) && !year && !followedByDay && !DATE_CONTEXT_BEFORE.test(before)) continue;

    const monthIndex = isFull ? MONTHS.indexOf(word) : ABBREVIATIONS[word];
    let y = year ?? currentYear;
    if (!year) {
      const qualifier = /\b(last|next)\s*$/.exec(before)?.[1];
      if (qualifier === "last" && monthIndex >= currentMonth) y -= 1;
      if (qualifier === "next" && monthIndex <= currentMonth) y += 1;
    }
    if (y >= 1900 && y <= 2200) add(monthRange(y, monthIndex));
  }

  // ISO dates: "2026-06-03"
  for (const m of lower.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const monthIndex = Number(m[2]) - 1;
    if (monthIndex >= 0 && monthIndex < 12) add(monthRange(Number(m[1]), monthIndex));
  }

  return ranges.slice(0, max);
}
