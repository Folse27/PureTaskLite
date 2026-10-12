import { tz } from "@date-fns/tz";
import {
  addDays,
  addWeeks,
  eachDayOfInterval,
  eachWeekOfInterval,
  endOfMonth,
  format,
  getYear,
  isMatch,
  isMonday,
  nextMonday,
  parseISO,
  startOfWeek,
} from "date-fns";

/**
 * Calendar logic for the Years → Months → Weeks → Days tree.
 *
 * Calendar days are represented as ISO strings ("yyyy-MM-dd"). They are parsed
 * into local-midnight Date objects only for date-fns arithmetic, so the
 * runtime's own timezone never shifts a day. The only timezone-aware question
 * is "what day is it right now?", which is answered in Europe/Berlin.
 */

export const APP_TIME_ZONE = "Europe/Berlin";
export const FIRST_YEAR = 2024;
/** Years shown by default after the current year. */
export const YEARS_AHEAD = 2;

export type ISODate = string;

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isISODate(value: string): boolean {
  return ISO_DATE_RE.test(value) && isMatch(value, "yyyy-MM-dd");
}

export function toISODate(date: Date): ISODate {
  return format(date, "yyyy-MM-dd");
}

export function fromISODate(value: ISODate): Date {
  return parseISO(value);
}

/** Today's calendar date in Europe/Berlin, regardless of server/browser timezone. */
export function todayISO(now: Date = new Date()): ISODate {
  return format(now, "yyyy-MM-dd", { in: tz(APP_TIME_ZONE) });
}

export function addDaysISO(value: ISODate, amount: number): ISODate {
  return toISODate(addDays(fromISODate(value), amount));
}

/** Monday of the week containing the given day. */
export function weekStartOf(value: ISODate): ISODate {
  return toISODate(startOfWeek(fromISODate(value), { weekStartsOn: 1 }));
}

/**
 * Mondays of all weeks that belong to a month. A week belongs to the month
 * (and year) in which its Monday falls.
 */
export function weeksOfMonth(year: number, monthIndex: number): ISODate[] {
  const first = new Date(year, monthIndex, 1);
  const firstMonday = isMonday(first) ? first : nextMonday(first);
  const last = endOfMonth(first);
  if (firstMonday > last) return [];
  return eachWeekOfInterval({ start: firstMonday, end: last }, { weekStartsOn: 1 }).map(toISODate);
}

/** All seven days (Monday → Sunday) of the week starting on `monday`. */
export function daysOfWeek(monday: ISODate): ISODate[] {
  const start = fromISODate(monday);
  return eachDayOfInterval({ start, end: addDays(start, 6) }).map(toISODate);
}

export function weekEnd(monday: ISODate): ISODate {
  return toISODate(addDays(fromISODate(monday), 6));
}

/** "12.10.2026-18.10.2026" */
export function weekLabel(monday: ISODate): string {
  const start = fromISODate(monday);
  return `${format(start, "dd.MM.yyyy")}-${format(addDays(start, 6), "dd.MM.yyyy")}`;
}

/** "MON 12.10.2026" */
export function dayLabel(value: ISODate): string {
  const date = fromISODate(value);
  return `${format(date, "EEE").toUpperCase()} ${format(date, "dd.MM.yyyy")}`;
}

/** Year and month (0-based) under which the week containing `value` is listed. */
export function treePositionOf(value: ISODate): { year: number; monthIndex: number; week: ISODate } {
  const week = weekStartOf(value);
  const monday = fromISODate(week);
  return { year: getYear(monday), monthIndex: monday.getMonth(), week };
}

/** Years shown in the tree: 2024 … current year + 2, plus any years added manually. */
export function visibleYears(today: ISODate, extraYears = 0): number[] {
  const current = getYear(fromISODate(today));
  const last = Math.max(current, FIRST_YEAR) + YEARS_AHEAD + Math.max(0, extraYears);
  const years: number[] = [];
  for (let y = FIRST_YEAR; y <= last; y++) years.push(y);
  return years;
}

/** Inclusive date range covered by a year in the tree (from its first Monday to that week's Sunday). */
export function yearRange(year: number): { from: ISODate; to: ISODate } {
  const firstWeeks = weeksOfMonth(year, 0);
  const lastWeeks = weeksOfMonth(year, 11);
  return { from: firstWeeks[0], to: weekEnd(lastWeeks[lastWeeks.length - 1]) };
}

/** Human-readable context used in the AI system prompt. */
export function describeToday(now: Date = new Date()) {
  const today = todayISO(now);
  const date = fromISODate(today);
  const thisMonday = weekStartOf(today);
  const nextWeekMonday = addDaysISO(thisMonday, 7);
  const fmt = (d: ISODate) => format(fromISODate(d), "EEEE yyyy-MM-dd");
  return {
    today,
    weekday: format(date, "EEEE"),
    long: format(date, "EEEE, d MMMM yyyy"),
    time: format(now, "HH:mm", { in: tz(APP_TIME_ZONE) }),
    thisWeek: daysOfWeek(thisMonday).map(fmt),
    nextWeek: daysOfWeek(nextWeekMonday).map(fmt),
    weekAfterMonday: addDaysISO(nextWeekMonday, 7),
  };
}

export const MAX_EXTRA_YEARS = 50;

/** The week's Monday, `n` weeks after the given Monday. */
export function shiftWeek(monday: ISODate, n: number): ISODate {
  return toISODate(addWeeks(fromISODate(monday), n));
}
