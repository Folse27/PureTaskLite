import { describe, expect, it } from "vitest";
import {
  dayLabel,
  daysOfWeek,
  describeToday,
  isISODate,
  todayISO,
  treePositionOf,
  visibleYears,
  weekLabel,
  weekStartOf,
  weeksOfMonth,
} from "./dates";

describe("weekLabel / dayLabel", () => {
  it("formats a week as DD.MM.YYYY-DD.MM.YYYY", () => {
    expect(weekLabel("2026-10-12")).toBe("12.10.2026-18.10.2026");
    expect(weekLabel("2026-10-19")).toBe("19.10.2026-25.10.2026");
  });

  it("formats days with an upper-case weekday", () => {
    expect(dayLabel("2026-10-12")).toBe("MON 12.10.2026");
    expect(dayLabel("2026-10-13")).toBe("TUE 13.10.2026");
    expect(dayLabel("2026-10-18")).toBe("SUN 18.10.2026");
  });
});

describe("weeksOfMonth", () => {
  it("lists every week whose Monday falls in the month", () => {
    expect(weeksOfMonth(2026, 9)).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
  });

  it("includes a week that starts on the 1st", () => {
    // 1 June 2026 is a Monday
    expect(weeksOfMonth(2026, 5)[0]).toBe("2026-06-01");
  });

  it("lists the last week of a month even when it spills into the next month", () => {
    const october = weeksOfMonth(2026, 9);
    expect(october.at(-1)).toBe("2026-10-26");
    expect(daysOfWeek("2026-10-26")).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
    // ...and it is not repeated under November
    expect(weeksOfMonth(2026, 10)[0]).toBe("2026-11-02");
  });

  it("puts the year-boundary week under December of the earlier year", () => {
    const december2025 = weeksOfMonth(2025, 11);
    expect(december2025.at(-1)).toBe("2025-12-29");
    expect(weekLabel("2025-12-29")).toBe("29.12.2025-04.01.2026");
    expect(daysOfWeek("2025-12-29").map(dayLabel)).toEqual([
      "MON 29.12.2025",
      "TUE 30.12.2025",
      "WED 31.12.2025",
      "THU 01.01.2026",
      "FRI 02.01.2026",
      "SAT 03.01.2026",
      "SUN 04.01.2026",
    ]);
    expect(weeksOfMonth(2026, 0)[0]).toBe("2026-01-05");
  });

  it("covers every day of a year exactly once across all months (2024 leap year … 2028)", () => {
    for (const year of [2024, 2025, 2026, 2027, 2028]) {
      const seen = new Set<string>();
      for (let m = 0; m < 12; m++) {
        for (const monday of weeksOfMonth(year, m)) {
          for (const day of daysOfWeek(monday)) {
            expect(seen.has(day)).toBe(false);
            seen.add(day);
          }
        }
      }
      // 52 or 53 weeks
      expect([364, 371]).toContain(seen.size);
    }
  });

  it("handles February in leap and non-leap years", () => {
    expect(weeksOfMonth(2024, 1)).toEqual(["2024-02-05", "2024-02-12", "2024-02-19", "2024-02-26"]);
    expect(daysOfWeek("2024-02-26").at(3)).toBe("2024-02-29");
    expect(weeksOfMonth(2027, 1)).toEqual(["2027-02-01", "2027-02-08", "2027-02-15", "2027-02-22"]);
  });

  it("is not affected by DST transitions", () => {
    // DST in Europe ends 25 Oct 2026 and starts 29 Mar 2026
    expect(daysOfWeek("2026-10-19").at(-1)).toBe("2026-10-25");
    expect(daysOfWeek("2026-03-23").at(-1)).toBe("2026-03-29");
    expect(weeksOfMonth(2026, 2)).toEqual(["2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23", "2026-03-30"]);
  });
});

describe("treePositionOf", () => {
  it("maps a day to the month of its week's Monday", () => {
    expect(treePositionOf("2026-01-02")).toEqual({ year: 2025, monthIndex: 11, week: "2025-12-29" });
    expect(treePositionOf("2026-11-01")).toEqual({ year: 2026, monthIndex: 9, week: "2026-10-26" });
    expect(treePositionOf("2026-10-12")).toEqual({ year: 2026, monthIndex: 9, week: "2026-10-12" });
  });

  it("weekStartOf returns the Monday", () => {
    expect(weekStartOf("2026-10-18")).toBe("2026-10-12");
    expect(weekStartOf("2026-10-19")).toBe("2026-10-19");
  });
});

describe("todayISO (Europe/Berlin)", () => {
  it("uses Berlin time, not UTC", () => {
    // 22:30 UTC on 11 Oct = 00:30 CEST on 12 Oct
    expect(todayISO(new Date("2026-10-11T22:30:00Z"))).toBe("2026-10-12");
    // 23:30 UTC on 31 Dec = 00:30 CET on 1 Jan
    expect(todayISO(new Date("2025-12-31T23:30:00Z"))).toBe("2026-01-01");
    expect(todayISO(new Date("2026-10-12T21:59:00Z"))).toBe("2026-10-12");
  });

  it("describes today for the assistant", () => {
    const d = describeToday(new Date("2026-10-12T08:00:00Z"));
    expect(d.today).toBe("2026-10-12");
    expect(d.weekday).toBe("Monday");
    expect(d.thisWeek[0]).toBe("Monday 2026-10-12");
    expect(d.nextWeek[4]).toBe("Friday 2026-10-23");
  });
});

describe("visibleYears", () => {
  it("shows 2024 through current year + 2", () => {
    expect(visibleYears("2026-10-12")).toEqual([2024, 2025, 2026, 2027, 2028]);
  });

  it("extends with manually added years", () => {
    expect(visibleYears("2026-10-12", 2)).toEqual([2024, 2025, 2026, 2027, 2028, 2029, 2030]);
  });
});

describe("isISODate", () => {
  it("accepts valid dates and rejects invalid ones", () => {
    expect(isISODate("2026-10-12")).toBe(true);
    expect(isISODate("2024-02-29")).toBe(true);
    expect(isISODate("2026-02-29")).toBe(false);
    expect(isISODate("2026-13-01")).toBe(false);
    expect(isISODate("12.10.2026")).toBe(false);
    expect(isISODate("2026-1-1")).toBe(false);
  });
});
