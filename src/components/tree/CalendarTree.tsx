"use client";

import { useEffect, useMemo } from "react";
import { countForDate, usePlanner } from "@/client/planner-store";
import { dayKey, monthKey, useUi, weekKey, yearKey } from "@/client/ui-store";
import {
  dayLabel,
  daysOfWeek,
  fromISODate,
  MAX_EXTRA_YEARS,
  MONTH_NAMES,
  visibleYears,
  weekLabel,
  weekStartOf,
  weeksOfMonth,
} from "@/lib/dates";
import { Plus } from "../icons";
import { AddTaskRow, TaskList } from "./TaskList";
import { Chevron, CountBadge, DateTreeItem, handleTreeKeyDown } from "./TreeItem";

interface Ctx {
  today: string;
  currentWeek: string;
}

export function CalendarTree({ today }: { today: string }) {
  const extraYears = useUi((s) => s.extraYears);
  const addYear = useUi((s) => s.addYear);
  const years = useMemo(() => visibleYears(today, extraYears), [today, extraYears]);
  const ctx = useMemo(() => ({ today, currentWeek: weekStartOf(today) }), [today]);

  return (
    <>
      <ul role="tree" aria-label="Calendar" onKeyDown={handleTreeKeyDown} className="space-y-1">
        {years.map((year, i) => (
          <YearNode key={year} year={year} ctx={ctx} first={i === 0} />
        ))}
      </ul>
      {extraYears < MAX_EXTRA_YEARS && (
        <button
          type="button"
          onClick={addYear}
          className="pressable mt-4 inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-[15px] font-medium text-accent hover:bg-accent-tint"
        >
          <Plus size={18} />
          Add year
        </button>
      )}
    </>
  );
}

function YearNode({ year, ctx, first }: { year: number; ctx: Ctx; first: boolean }) {
  const key = yearKey(year);
  const expanded = useUi((s) => !!s.expanded[key]);
  const toggle = useUi((s) => s.toggle);
  const current = ctx.today.startsWith(`${year}-`);

  return (
    <DateTreeItem
      nodeKey={key}
      level={1}
      label={`${year}${current ? ", current year" : ""}`}
      expanded={expanded}
      onToggle={() => toggle(key)}
      defaultTabStop={first}
      rowClassName="-mx-2 rounded-xl px-2 hover:bg-fill"
      groupClassName="space-y-1 pb-4 pt-1"
      row={
        <>
          <Chevron open={expanded} size={18} />
          <span className="tabular text-[28px] font-bold leading-tight tracking-[-0.025em]">{year}</span>
          {current && (
            <span className="ml-1 mt-1 h-2 w-2 rounded-full bg-accent" aria-hidden="true" title="Current year" />
          )}
        </>
      }
    >
      {MONTH_NAMES.map((name, monthIndex) => (
        <MonthNode key={name} year={year} monthIndex={monthIndex} ctx={ctx} />
      ))}
    </DateTreeItem>
  );
}

function MonthNode({ year, monthIndex, ctx }: { year: number; monthIndex: number; ctx: Ctx }) {
  const key = monthKey(year, monthIndex);
  const expanded = useUi((s) => !!s.expanded[key]);
  const toggle = useUi((s) => s.toggle);
  const weeks = useMemo(() => (expanded ? weeksOfMonth(year, monthIndex) : []), [expanded, year, monthIndex]);
  const name = MONTH_NAMES[monthIndex];
  const hasCurrentWeek = useMemo(() => {
    const monday = fromISODate(ctx.currentWeek);
    return monday.getFullYear() === year && monday.getMonth() === monthIndex;
  }, [ctx.currentWeek, year, monthIndex]);

  return (
    <DateTreeItem
      nodeKey={key}
      level={2}
      label={`${name} ${year}`}
      expanded={expanded}
      onToggle={() => toggle(key)}
      rowClassName="-mx-2 rounded-xl px-2 hover:bg-fill"
      groupClassName="mb-3 mt-1 overflow-hidden rounded-2xl bg-surface shadow-soft"
      row={
        <>
          <Chevron open={expanded} />
          <span className={`text-[20px] font-semibold tracking-[-0.02em] ${hasCurrentWeek ? "text-accent" : ""}`}>
            {name}
          </span>
        </>
      }
    >
      {weeks.map((monday, i) => (
        <WeekNode key={monday} monday={monday} ctx={ctx} divider={i > 0} />
      ))}
    </DateTreeItem>
  );
}

function WeekNode({ monday, ctx, divider }: { monday: string; ctx: Ctx; divider: boolean }) {
  const key = weekKey(monday);
  const expanded = useUi((s) => !!s.expanded[key]);
  const toggle = useUi((s) => s.toggle);
  const loadWeek = usePlanner((s) => s.loadWeek);
  const days = useMemo(() => daysOfWeek(monday), [monday]);
  const count = usePlanner((s) => days.reduce((n, d) => n + countForDate(s, d), 0));
  const current = monday === ctx.currentWeek;
  const label = weekLabel(monday);

  useEffect(() => {
    if (expanded) void loadWeek(monday);
  }, [expanded, monday, loadWeek]);

  return (
    <DateTreeItem
      nodeKey={key}
      level={3}
      label={`Week ${label}${current ? ", this week" : ""}${!expanded && count ? `, ${count} task${count === 1 ? "" : "s"}` : ""}`}
      expanded={expanded}
      onToggle={() => toggle(key)}
      rowClassName={`pl-3 pr-4 hover:bg-fill ${current ? "bg-accent-tint" : ""} ${
        divider ? "border-t border-separator" : ""
      }`}
      groupClassName="pb-2"
      row={
        <>
          {current && <span className="absolute inset-y-2 left-0 w-[3px] rounded-r-full bg-accent" aria-hidden="true" />}
          <Chevron open={expanded} />
          <span className={`tabular text-[15px] font-medium ${current ? "text-accent" : ""}`}>{label}</span>
          {current && (
            <span className="rounded-full bg-accent-fill px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.02em] text-white">
              This week
            </span>
          )}
          {!expanded && <CountBadge count={count} label="task" />}
        </>
      }
    >
      {days.map((date) => (
        <DayNode key={date} date={date} ctx={ctx} />
      ))}
    </DateTreeItem>
  );
}

function DayNode({ date, ctx }: { date: string; ctx: Ctx }) {
  const key = dayKey(date);
  const expanded = useUi((s) => !!s.expanded[key]);
  const toggle = useUi((s) => s.toggle);
  const count = usePlanner((s) => countForDate(s, date));
  const loaded = usePlanner((s) => !!s.tasksByDate[date]);
  const isToday = date === ctx.today;
  const label = dayLabel(date);
  const [weekday, ddmmyyyy] = label.split(" ");
  const weekend = weekday === "SAT" || weekday === "SUN";

  return (
    <DateTreeItem
      nodeKey={key}
      level={4}
      label={`${label}${isToday ? ", today" : ""}${!expanded && count ? `, ${count} task${count === 1 ? "" : "s"}` : ""}`}
      expanded={expanded}
      onToggle={() => toggle(key)}
      rowClassName="pr-4 hover:bg-fill"
      rowStyle={{ paddingLeft: "calc(var(--tree-indent) + 12px)" }}
      bareChildren
      row={
        <>
          <Chevron open={expanded} size={14} />
          <span
            className={`tabular text-[15px] ${
              isToday ? "font-semibold text-accent" : weekend ? "text-label-2" : ""
            }`}
          >
            <span className="inline-block w-[3.1em] font-semibold tracking-[0.02em]">{weekday}</span>
            {ddmmyyyy}
          </span>
          {isToday && (
            <span className="rounded-full bg-accent-fill px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.02em] text-white">
              Today
            </span>
          )}
          {!expanded && <CountBadge count={count} label="task" />}
        </>
      }
    >
      {loaded ? (
        <>
          <TaskList date={date} parentId={null} depth={0} />
          <AddTaskRow date={date} />
        </>
      ) : (
        <p className="py-2.5 text-[14px] text-label-2" style={{ paddingLeft: "calc(var(--tree-indent) * 2 + 20px)" }}>
          Loading…
        </p>
      )}
    </DateTreeItem>
  );
}
