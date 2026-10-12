import { describe, expect, it } from "vitest";
import { findMentionedRanges } from "./date-refs";

const TODAY = "2026-10-12";
const labels = (text: string, today = TODAY) => findMentionedRanges(text, today).map((r) => r.label);

describe("findMentionedRanges", () => {
  it("finds a month with a year in any common phrasing", () => {
    expect(findMentionedRanges("What did I do in June, 2026?", TODAY)).toEqual([
      { from: "2026-06-01", to: "2026-06-30", label: "June 2026" },
    ]);
    expect(labels("what happened in june 2025")).toEqual(["June 2025"]);
    expect(labels("tasks from June of 2024")).toEqual(["June 2024"]);
  });

  it("uses the current year when none is given", () => {
    expect(labels("What did I do in June?")).toEqual(["June 2026"]);
  });

  it("resolves last/next month and last/next <month>", () => {
    expect(labels("what did I do last month")).toEqual(["September 2026"]);
    expect(labels("plans for next month")).toEqual(["November 2026"]);
    expect(labels("what did I do last November")).toEqual(["November 2025"]);
    expect(labels("next March")).toEqual(["March 2027"]);
    expect(labels("next December")).toEqual(["December 2026"]);
  });

  it("handles year boundaries", () => {
    expect(labels("last month", "2026-01-15")).toEqual(["December 2025"]);
    expect(labels("next month", "2026-12-03")).toEqual(["January 2027"]);
  });

  it("does not mistake everyday words for months", () => {
    expect(labels("May I add a task for tomorrow?")).toEqual([]);
    expect(labels("you may delete it")).toEqual([]);
    expect(labels("march on with the plan")).toEqual([]);
    expect(labels("ask Jan about it")).toEqual([]);
    expect(labels("add gym tomorrow")).toEqual([]);
  });

  it("accepts ambiguous month words with a clear date context", () => {
    expect(labels("what did I do in May")).toEqual(["May 2026"]);
    expect(labels("dentist on March 3rd")).toEqual(["March 2026"]);
    expect(labels("the 3rd of May")).toEqual(["May 2026"]);
    expect(labels("Jan 2027 plans")).toEqual(["January 2027"]);
  });

  it("finds several months, deduplicated and capped", () => {
    expect(labels("compare June and July 2026 and June again")).toEqual(["June 2026", "July 2026"]);
    expect(labels("january february march april")).toHaveLength(3);
  });

  it("finds months of ISO dates", () => {
    expect(labels("move it to 2027-02-14")).toEqual(["February 2027"]);
  });
});
