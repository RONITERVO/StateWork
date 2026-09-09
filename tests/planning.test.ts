import { describe, expect, it } from 'vitest';
import {
  emptyState,
  planWork,
  planDayBounds,
  shiftPlanDate,
  logPlanningMinutes,
  planningProgress,
  transition,
} from '@statework/core';
import type { WorkItem, WorkState } from '@statework/core';
import {
  calendarDates,
  calendarPlan,
  calendarUsed,
  newCalendarPreferences,
  restoreCalendarPreferences,
} from '../packages/reference/src/spatial/calendar-model';
const now = '2026-09-09T08:00:00.000Z';
const options = { now, timeZone: 'Europe/Helsinki' };
function task(id: string, patch: Partial<WorkItem> = {}): WorkItem {
  return {
    id,
    title: id,
    kind: 'task',
    status: 'ready',
    priority: 0,
    description: '',
    tags: [],
    effortMinutes: 60,
    dueDate: null,
    schedule: null,
    extensions: {},
    archived: false,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}
function graph(items: WorkItem[], edges: [string, string][] = []): WorkState {
  return {
    ...emptyState('plan', 'Plan', now),
    items,
    relations: edges.map(([from, to], i) => ({ id: `e${i}`, from, to, kind: 'depends_on' })),
  };
}
describe('read-only daily planning', () => {
  it('does not charge an exhausted estimate review block again when logged work is finished', () => {
    const state = graph([task('a'), task('b', { effortMinutes: 240 })]),
      prefs = newCalendarPreferences();
    prefs.day = '2026-09-09';
    prefs.override = { minutes: 60, used: 0 };
    calendarPlan(state, prefs, now, options.timeZone);
    state.items[0]!.extensions = {
      'statework.planning/progress': { minutes: 60, days: { '2026-09-09': 60 } },
    };
    calendarPlan(state, prefs, now, options.timeZone);
    prefs.override = { minutes: 120, used: calendarUsed(state, prefs) };
    calendarPlan(state, prefs, now, options.timeZone);
    state.items[0]!.status = 'done';
    const plan = calendarPlan(state, prefs, now, options.timeZone);
    expect(calendarUsed(state, prefs)).toBe(60);
    expect(plan.days[0]!.capacityMinutes).toBe(120);
    expect(plan.days[0]!.suggestions.every((s) => s.id === 'b')).toBe(true);
  });
  it('supports valid IDs that match Object prototype properties and pulls a chosen task’s requirements forward', () => {
    const state = graph(
      [task('constructor'), task('toString'), task('a'), task('chosen')],
      [['chosen', 'toString']],
    );
    const prefs = newCalendarPreferences();
    prefs.preferred = ['chosen'];
    const plan = calendarPlan(state, prefs, now, options.timeZone);
    expect(plan.days[0]!.suggestions.map((s) => s.id)).toEqual([
      'toString',
      'chosen',
      'a',
      'constructor',
    ]);
    expect(Number.isFinite(calendarUsed(state, prefs))).toBe(true);
    state.items[0]!.status = 'done';
    expect(calendarPlan(state, prefs, now, options.timeZone).days[0]!.capacityMinutes).toBe(180);
  });
  it('retains completed allocations across reload, reverses them on undo and resets only daily choices overnight', () => {
    const state = graph([task('a'), task('b'), task('c')]),
      prefs = newCalendarPreferences();
    prefs.override = { minutes: 120, used: 0 };
    prefs.day = '2026-09-09';
    expect(calendarPlan(state, prefs, now, options.timeZone).days[0]!.plannedMinutes).toBe(120);
    state.items[0]!.status = 'done';
    expect(calendarPlan(state, prefs, now, options.timeZone).days[0]!.plannedMinutes).toBe(60);
    const restored = restoreCalendarPreferences(JSON.stringify(prefs));
    expect(calendarUsed(state, restored)).toBe(60);
    expect(calendarPlan(state, restored, now, options.timeZone).days[0]!.plannedMinutes).toBe(60);
    state.items[0]!.status = 'ready';
    expect(calendarPlan(state, restored, now, options.timeZone).days[0]!.plannedMinutes).toBe(120);
    restored.notBefore.c = '2026-09-15';
    calendarPlan(state, restored, '2026-09-10T08:00:00.000Z', options.timeZone);
    expect(restored.override).toBeNull();
    expect(restored.notBefore.c).toBe('2026-09-15');
    expect(calendarDates('2026-09-09', 'month')).toHaveLength(42);
    expect(calendarDates('2026-09-09', 'week')).toEqual([
      '2026-09-07',
      '2026-09-08',
      '2026-09-09',
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
    ]);
    expect(restoreCalendarPreferences('{broken')).toEqual(newCalendarPreferences());
  });
  it('orders deadline-free prerequisites and respects four-hour weekdays without changing records', () => {
    const state = graph(
      [task('a'), task('b'), task('c'), task('d'), task('e')],
      [
        ['b', 'a'],
        ['c', 'b'],
      ],
    );
    const before = structuredClone(state),
      plan = planWork(state, options);
    expect(plan.days[0]!.suggestions.map((x) => x.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(plan.days[0]!.suggestions[1]!.conditional).toBe(true);
    expect(plan.days[1]!.suggestions.map((x) => x.id)).toEqual(['e']);
    expect(plan.days[3]!.capacityMinutes).toBe(0);
    expect(state).toEqual(before);
    expect(planWork(state, options)).toEqual(plan);
  });
  it('pulls urgent prerequisites forward, but respects an explicit defer and never bypasses a requirement', () => {
    const state = graph(
      [task('a'), task('z'), task('urgent', { dueDate: '2026-09-09' })],
      [['urgent', 'z']],
    );
    expect(planWork(state, options).days[0]!.suggestions.map((x) => x.id)).toEqual([
      'z',
      'urgent',
      'a',
    ]);
    const plan = planWork(state, {
      ...options,
      preferred: ['urgent'],
      notBefore: { z: '2026-09-10' },
    });
    expect(plan.days[0]!.suggestions.map((x) => x.id)).toEqual(['a']);
    expect(plan.days[1]!.suggestions.map((x) => x.id)).toEqual(['z', 'urgent']);
    expect(plan.days[1]!.suggestions[1]!.late).toBe(true);
  });
  it('splits large work, labels unknown estimates, and accounts for explicit progress even after completion', () => {
    let state = graph([task('a', { effortMinutes: 500 }), task('b', { effortMinutes: null })]);
    const first = planWork(state, { ...options, days: 2 });
    expect(first.counts).toMatchObject({ partiallyProjected: 1, unplaced: 1 });
    expect(first.unplaced.find((x) => x.id === 'a')?.remainingMinutes).toBe(20);
    const command = logPlanningMinutes(state.items[0]!, '2026-09-09', 60);
    state = transition(
      state,
      { schemaVersion: 1, requestId: 'log', expectedRevision: 0, commands: [command] },
      { id: 'owner', role: 'owner' },
      now,
    ).state;
    expect(planningProgress(state.items[0]!).minutes).toBe(60);
    expect(planWork(state, options).days[0]!.capacityMinutes).toBe(180);
    state.items[0]!.status = 'done';
    const plan = planWork(state, options);
    expect(plan.days[0]!.capacityMinutes).toBe(180);
    expect(plan.days[0]!.suggestions[0]).toMatchObject({ id: 'b', minutes: 30, estimated: true });
  });
  it('caps a late start by the remaining local day and supports a one-click day off', () => {
    const state = graph([task('a')]);
    expect(
      planWork(state, { ...options, now: '2026-09-09T20:45:00.000Z' }).days[0]!.plannedMinutes,
    ).toBe(15);
    expect(planWork(state, { ...options, todayMinutes: 0 }).days[0]!.suggestions).toEqual([]);
    expect(planWork(state, { ...options, todayMinutes: 30 }).days[0]!.plannedMinutes).toBe(30);
  });
  it('uses actual local midnight across DST, leap days and month boundaries', () => {
    const spring = planDayBounds('2026-03-29', 'Europe/Helsinki');
    const autumn = planDayBounds('2026-10-25', 'Europe/Helsinki');
    expect((spring.end - spring.start) / 3600000).toBe(23);
    expect((autumn.end - autumn.start) / 3600000).toBe(25);
    expect(shiftPlanDate('2028-02-28', 2)).toBe('2028-03-01');
    expect(shiftPlanDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(() => planWork(graph([]), { ...options, timeZone: 'Unknown/Zone' })).toThrow();
    expect(() => shiftPlanDate('9999-12-31', 1)).toThrow();
  });
  it('unions overnight and overlapping appointments without double subtracting free time', () => {
    const schedule = (start: string, end: string) => ({ start, end, timeZone: 'Europe/Helsinki' });
    const state = graph([
      task('a', { effortMinutes: 600 }),
      task('meeting', {
        kind: 'event',
        schedule: schedule('2026-09-09T19:00:00.000Z', '2026-09-10T01:00:00.000Z'),
      }),
      task('overlap', {
        kind: 'event',
        schedule: schedule('2026-09-09T20:00:00.000Z', '2026-09-09T22:00:00.000Z'),
      }),
    ]);
    const plan = planWork(state, {
      ...options,
      now: '2026-09-09T18:00:00.000Z',
      todayMinutes: 240,
      days: 2,
    });
    expect(plan.days[0]).toMatchObject({
      capacityMinutes: 60,
      plannedMinutes: 60,
      freeMinutes: 60,
      overlapMinutes: 60,
    });
    expect(plan.days[1]!.commitments).toHaveLength(2);
    expect(plan.days[1]!.freeMinutes).toBe(1200);
  });
  it('shows impossible fixed prerequisites and unfinished past slots explicitly', () => {
    const state = graph(
      [
        task('a', { effortMinutes: 240 }),
        task('b', {
          schedule: {
            start: '2026-09-09T08:30:00.000Z',
            end: '2026-09-09T09:00:00.000Z',
            timeZone: 'UTC',
          },
        }),
        task('past', {
          schedule: {
            start: '2026-09-08T08:00:00.000Z',
            end: '2026-09-08T09:00:00.000Z',
            timeZone: 'UTC',
          },
        }),
      ],
      [['b', 'a']],
    );
    expect(planWork(state, options).scheduleIssues).toEqual([
      { id: 'b', reason: 'prerequisite_timing' },
      { id: 'past', reason: 'past_slot' },
    ]);
  });
  it('keeps archived unfinished prerequisites blocked and completed prerequisites satisfied', () => {
    const state = graph(
      [task('a', { archived: true }), task('b'), task('done', { status: 'done' }), task('c')],
      [
        ['b', 'a'],
        ['c', 'done'],
      ],
    );
    const plan = planWork(state, options);
    expect(plan.days[0]!.suggestions.map((x) => x.id)).toEqual(['c']);
    expect(plan.unplaced).toContainEqual({
      id: 'b',
      remainingMinutes: 60,
      reason: 'prerequisites',
    });
  });
  it('accounts for every task in a 10,000-record workspace and exposes bounded output', () => {
    const state = graph(
      Array.from({ length: 10000 }, (_, i) => task(`t${i}`, { effortMinutes: 1 })),
    );
    const start = performance.now(),
      plan = planWork(state, { ...options, days: 2 });
    expect(plan.days[0]!.suggestionLimitReached).toBe(true);
    expect(
      plan.counts.fullyProjected +
        plan.counts.partiallyProjected +
        plan.counts.unplaced +
        plan.counts.fixed,
    ).toBe(10000);
    expect(performance.now() - start).toBeLessThan(5000);
  });
});
