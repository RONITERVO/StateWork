import {
  isFinished,
  isPlanDate,
  planDate,
  planningProgress,
  planWork,
  shiftPlanDate,
} from '@statework/sdk';
import type { WorkPlan, WorkState, WorkerContext } from '@statework/sdk';

export interface CalendarPreferences {
  dailyMinutes: number;
  workDays: number[];
  notBefore: Record<string, string>;
  preferred: string[];
  day: string;
  override: { minutes: number; used: number } | null;
  allocations: Record<string, { minutes: number; logged: number }>;
  reservations: Record<string, number>;
}
export const newCalendarPreferences = (): CalendarPreferences => ({
  dailyMinutes: 240,
  workDays: [1, 2, 3, 4, 5],
  notBefore: Object.create(null),
  preferred: [],
  day: '',
  override: null,
  allocations: Object.create(null),
  reservations: Object.create(null),
});
/** Browser-local preferences are untrusted; work records remain in the SDK/database. */
export function restoreCalendarPreferences(value: string): CalendarPreferences {
  const result = newCalendarPreferences();
  try {
    const p = JSON.parse(value);
    const amount = (n: unknown): n is number =>
      Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 10000000;
    const id = (s: string) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(s);
    if (amount(p.dailyMinutes) && p.dailyMinutes <= 720) result.dailyMinutes = p.dailyMinutes;
    if (
      Array.isArray(p.workDays) &&
      p.workDays.length <= 7 &&
      p.workDays.every((n: unknown) => amount(n) && n <= 6)
    )
      result.workDays = [...new Set<number>(p.workDays)];
    if (p.notBefore && typeof p.notBefore === 'object')
      for (const [key, date] of Object.entries(p.notBefore).slice(0, 10000))
        if (id(key) && typeof date === 'string' && isPlanDate(date)) result.notBefore[key] = date;
    if (Array.isArray(p.preferred))
      result.preferred = [
        ...new Set<string>(p.preferred.filter((s: unknown) => typeof s === 'string' && id(s))),
      ].slice(0, 10000);
    if (typeof p.day === 'string' && isPlanDate(p.day)) {
      result.day = p.day;
      if (
        p.override &&
        amount(p.override.minutes) &&
        p.override.minutes <= 720 &&
        amount(p.override.used)
      )
        result.override = p.override;
      if (p.allocations && typeof p.allocations === 'object')
        for (const [key, v] of Object.entries(p.allocations).slice(0, 10000)) {
          const a = v as { minutes: number; logged: number } | null;
          if (id(key) && a && amount(a.minutes) && amount(a.logged)) result.allocations[key] = a;
        }
      if (p.reservations && typeof p.reservations === 'object')
        for (const [key, v] of Object.entries(p.reservations).slice(0, 10000))
          if (id(key) && amount(v)) result.reservations[key] = v;
    }
  } catch {
    /* Invalid optional preferences reset, never work records. */
  }
  return result;
}
export function calendarUsed(state: WorkState, p: CalendarPreferences): number {
  return state.items.reduce(
    (sum, item) =>
      sum +
      (planningProgress(item).days[p.day] ?? 0) +
      Math.max(0, (p.reservations[item.id] ?? 0) - (planningProgress(item).days[p.day] ?? 0)),
    0,
  );
}
/** Reserve completed allocations so finishing today's work doesn't refill the same budget forever.
 * These reservations describe a plan; only explicit logged minutes are work-time records. */
export function calendarPlan(
  state: WorkState,
  p: CalendarPreferences,
  now: string,
  timeZone: string,
  worker: WorkerContext = {},
): WorkPlan {
  const today = planDate(now, timeZone);
  if (p.day !== today) {
    p.day = today;
    p.override = null;
    p.allocations = Object.create(null);
    p.reservations = Object.create(null);
  }
  const ids = new Set(state.items.map((i) => i.id));
  for (const key of Object.keys(p.notBefore))
    if (!ids.has(key) || p.notBefore[key]! < today) delete p.notBefore[key];
  p.preferred = p.preferred.filter((id) => ids.has(id));
  for (const item of state.items) {
    if (isFinished(item) && p.allocations[item.id]) {
      const allocation = p.allocations[item.id]!;
      // An unknown estimate is a review block. Logging it and then finishing must not
      // also charge the newly offered unknown block as if it had been performed.
      const progress = planningProgress(item);
      const logged = progress.days[today] ?? 0;
      const review = item.effortMinutes === null || progress.minutes >= item.effortMinutes;
      p.reservations[item.id] =
        review && logged > 0 ? logged : allocation.minutes + allocation.logged;
    } else if (!isFinished(item)) delete p.reservations[item.id];
  }
  const used = calendarUsed(state, p),
    workDay = p.workDays.includes(new Date(`${today}T12:00:00Z`).getUTCDay());
  const todayMinutes = Math.max(
    0,
    p.override
      ? p.override.minutes - (used - p.override.used)
      : (workDay ? p.dailyMinutes : 0) - used,
  );
  const plan = planWork(
    state,
    {
      now,
      timeZone,
      days: 90,
      dailyMinutes: p.dailyMinutes,
      workDays: p.workDays,
      todayMinutes: Math.min(720, todayMinutes),
      notBefore: p.notBefore,
      preferred: p.preferred,
    },
    worker,
  );
  p.allocations = Object.create(null);
  for (const s of plan.days[0]!.suggestions) {
    const a = p.allocations[s.id] ?? {
      minutes: 0,
      logged: planningProgress(state.items.find((i) => i.id === s.id)!).days[today] ?? 0,
    };
    a.minutes += s.minutes;
    p.allocations[s.id] = a;
  }
  return plan;
}
export function calendarDates(anchor: string, mode: 'month' | 'week'): string[] {
  const first = mode === 'month' ? `${anchor.slice(0, 7)}-01` : anchor;
  const weekday = new Date(`${first}T12:00:00Z`).getUTCDay();
  const start = shiftPlanDate(first, -((weekday + 6) % 7));
  return Array.from({ length: mode === 'month' ? 42 : 7 }, (_, i) => shiftPlanDate(start, i));
}
export function calendarMonth(anchor: string, delta: number): string {
  const date = new Date(`${anchor.slice(0, 7)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  return date.toISOString().slice(0, 10);
}
