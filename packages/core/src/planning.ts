import { isFinished, WorkError } from './model.js';
import type { Command, WorkItem, WorkState } from './model.js';
import { latestPacket, packetActionable } from './instructions.js';
import type { WorkerContext } from './execution.js';

export const planningProgressNamespace = 'statework.planning/progress';
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
export interface PlanOptions {
  now: string;
  timeZone: string;
  days?: number;
  dailyMinutes?: number;
  /** Remaining focus capacity today, rather than a new commitment or deadline. */
  todayMinutes?: number;
  workDays?: number[];
  defaultMinutes?: number;
  blockMinutes?: number;
  notBefore?: Record<string, string>;
  preferred?: string[];
}
export type PlanReason = 'chosen' | 'deadline' | 'continue' | 'priority' | 'unlocks' | 'ready';
export interface PlanSuggestion {
  id: string;
  minutes: number;
  order: number;
  reason: PlanReason;
  estimated: boolean;
  continuation: boolean;
  conditional: boolean;
  completesEstimate: boolean;
  deadline: string | null;
  late: boolean;
}
export interface PlanCommitment {
  id: string;
  start: string;
  end: string;
  needsFirst: boolean;
}
export interface PlanDay {
  date: string;
  workDay: boolean;
  capacityMinutes: number;
  loggedMinutes: number;
  plannedMinutes: number;
  freeMinutes: number;
  overlapMinutes: number;
  /** True when the bounded output limit, rather than time, stopped allocation. */
  suggestionLimitReached: boolean;
  suggestions: PlanSuggestion[];
  commitments: PlanCommitment[];
  deadlines: string[];
}
export interface WorkPlan {
  schemaVersion: 1;
  workspaceId: string;
  revision: number;
  generatedAt: string;
  timeZone: string;
  today: string;
  days: PlanDay[];
  unplaced: {
    id: string;
    remainingMinutes: number;
    reason: 'prerequisites' | 'packet' | 'later' | 'capacity';
  }[];
  scheduleIssues: { id: string; reason: 'past_slot' | 'prerequisite_timing' | 'packet' }[];
  counts: {
    openTasks: number;
    fixed: number;
    fullyProjected: number;
    partiallyProjected: number;
    unplaced: number;
  };
}
export function isPlanDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
  );
}
export function shiftPlanDate(date: string, days: number): string {
  if (!isPlanDate(date) || !Number.isSafeInteger(days))
    throw new WorkError('VALIDATION', 'Invalid calendar date.');
  const result = new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000);
  if (
    !Number.isFinite(result.getTime()) ||
    result.getUTCFullYear() < 1 ||
    result.getUTCFullYear() > 9999
  )
    throw new WorkError('VALIDATION', 'Calendar horizon is outside years 0001–9999.');
  return result.toISOString().slice(0, 10);
}
const dateFormatter = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    calendar: 'gregory',
    numberingSystem: 'latn',
  });
function formattedDate(formatter: Intl.DateTimeFormat, instant: number): string {
  const parts = formatter.formatToParts(instant);
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join('-');
}
export function planDate(instant: string | number, timeZone: string): string {
  return formattedDate(
    dateFormatter(timeZone),
    typeof instant === 'number' ? instant : Date.parse(instant),
  );
}
/** Finds the first instant of a local date; neither a day nor a UTC offset is assumed constant. */
export function planDayBounds(date: string, timeZone: string): { start: number; end: number } {
  if (!isPlanDate(date)) throw new WorkError('VALIDATION', 'Invalid calendar date.');
  const formatter = dateFormatter(timeZone);
  const boundary = (day: string) => {
    const guess = Date.parse(`${day}T00:00:00Z`);
    let low = guess - 36 * 3600000,
      high = guess + 36 * 3600000;
    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2);
      if (formattedDate(formatter, mid) < day) low = mid;
      else high = mid;
    }
    return high;
  };
  return { start: boundary(date), end: boundary(shiftPlanDate(date, 1)) };
}
export function planningProgress(item: WorkItem): {
  minutes: number;
  days: Record<string, number>;
} {
  const value = item.extensions[planningProgressNamespace];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { minutes: 0, days: {} };
  const valid = (v: unknown): v is number =>
    typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 5256000;
  const days: Record<string, number> = {};
  if (value.days && typeof value.days === 'object' && !Array.isArray(value.days))
    for (const [date, minutes] of Object.entries(value.days))
      if (isPlanDate(date) && valid(minutes)) days[date] = minutes;
  return { minutes: valid(value.minutes) ? value.minutes : 0, days };
}
/** Explicit user-attested progress. The normal command pipeline supplies identity, validation and history. */
export function logPlanningMinutes(item: WorkItem, date: string, minutes: number): Command {
  if (
    !isPlanDate(date) ||
    !Number.isSafeInteger(minutes) ||
    minutes < 1 ||
    minutes > 720 ||
    isFinished(item) ||
    item.kind !== 'task'
  )
    throw new WorkError('VALIDATION', 'Choose 1–720 minutes for unfinished work.');
  const progress = planningProgress(item);
  const days = Object.fromEntries(
    Object.entries({ ...progress.days, [date]: (progress.days[date] ?? 0) + minutes })
      .sort(([a], [b]) => compareText(a, b))
      .slice(-366),
  );
  if (progress.minutes + minutes > 5256000 || (progress.days[date] ?? 0) + minutes > 5256000)
    throw new WorkError('LIMIT', 'Progress exceeds the supported total.');
  return {
    type: 'item.update',
    id: item.id,
    expectedVersion: item.version,
    patch: {
      extensions: {
        ...item.extensions,
        [planningProgressNamespace]: { minutes: progress.minutes + minutes, days },
      },
    },
  };
}
class Heap<T> {
  private entries: T[] = [];
  constructor(private before: (a: T, b: T) => boolean) {}
  peek() {
    return this.entries[0];
  }
  push(value: T) {
    let at = this.entries.length;
    this.entries.push(value);
    while (at) {
      const parent = (at - 1) >> 1;
      if (!this.before(value, this.entries[parent]!)) break;
      this.entries[at] = this.entries[parent]!;
      at = parent;
    }
    this.entries[at] = value;
  }
  pop(): T | undefined {
    const first = this.entries[0],
      last = this.entries.pop();
    if (this.entries.length && last !== undefined) {
      let at = 0;
      while (at * 2 + 1 < this.entries.length) {
        let child = at * 2 + 1;
        if (
          child + 1 < this.entries.length &&
          this.before(this.entries[child + 1]!, this.entries[child]!)
        )
          child++;
        if (!this.before(this.entries[child]!, last)) break;
        this.entries[at] = this.entries[child]!;
        at = child;
      }
      this.entries[at] = last;
    }
    return first;
  }
}
interface Node {
  item: WorkItem;
  packetBlocked: boolean;
  needs: string[];
  after: string[];
  pending: number;
  priority: number;
  deadline: string | null;
  left: number;
  allocated: number;
  estimated: boolean;
  conditional: boolean;
  finish: number;
}
/** Deterministic, read-only day recommendations; projected completion is never a work mutation. */
export function planWork(
  state: WorkState,
  options: PlanOptions,
  worker: WorkerContext = {},
): WorkPlan {
  const now = Date.parse(options.now);
  const count = options.days ?? 42,
    daily = options.dailyMinutes ?? 240,
    block = options.blockMinutes ?? 60,
    fallback = options.defaultMinutes ?? 30;
  const workDays = options.workDays ?? [1, 2, 3, 4, 5];
  const range = (v: number, min: number, max: number) =>
    Number.isSafeInteger(v) && v >= min && v <= max;
  if (
    !Number.isFinite(now) ||
    !range(count, 1, 90) ||
    !range(daily, 0, 720) ||
    !range(block, 5, 240) ||
    !range(fallback, 5, 240) ||
    (options.todayMinutes !== undefined && !range(options.todayMinutes, 0, 720)) ||
    !Array.isArray(workDays) ||
    workDays.some((day) => !range(day, 0, 6)) ||
    new Set(workDays).size !== workDays.length
  )
    throw new WorkError('VALIDATION', 'Invalid planning preferences.');
  let today: string;
  try {
    today = planDate(now, options.timeZone);
  } catch {
    throw new WorkError('VALIDATION', 'Unknown planning time zone.');
  }
  shiftPlanDate(today, count + 7);
  for (const date of Object.values(options.notBefore ?? {}))
    if (!isPlanDate(date)) throw new WorkError('VALIDATION', 'Invalid defer date.');
  const defers = new Map(Object.entries(options.notBefore ?? {}));
  const preferred = new Map((options.preferred ?? []).map((id, index) => [id, index]));
  const nodes = new Map<string, Node>();
  const logged: Record<string, number> = {};
  for (const item of state.items) {
    const progress = planningProgress(item);
    for (const [date, minutes] of Object.entries(progress.days))
      logged[date] = (logged[date] ?? 0) + minutes;
    const remaining =
      item.effortMinutes === null ? fallback : Math.max(0, item.effortMinutes - progress.minutes);
    const packet = latestPacket(state, item.id);
    nodes.set(item.id, {
      item,
      packetBlocked: !isFinished(item) && !!packet && !packetActionable(state, packet, worker),
      needs: [],
      after: [],
      pending: 0,
      priority: item.priority,
      deadline: isFinished(item) ? null : item.dueDate,
      left: remaining || fallback,
      allocated: 0,
      estimated: item.effortMinutes === null || remaining === 0,
      conditional: false,
      finish: isFinished(item) ? -Infinity : Infinity,
    });
  }
  for (const edge of state.relations)
    if (edge.kind === 'depends_on') {
      const from = nodes.get(edge.from),
        to = nodes.get(edge.to);
      if (!from || !to) throw new WorkError('VALIDATION', 'Broken planning prerequisite.');
      from.needs.push(edge.to);
      to.after.push(edge.from);
    }
  // A topological pass carries consumer priority/deadlines upstream without guessing relationships.
  const degree = new Map([...nodes].map(([id, node]) => [id, node.needs.length]));
  const ordered = [...nodes.keys()].filter((id) => degree.get(id) === 0);
  for (let at = 0; at < ordered.length; at++)
    for (const id of nodes.get(ordered[at]!)!.after) {
      degree.set(id, degree.get(id)! - 1);
      if (!degree.get(id)) ordered.push(id);
    }
  if (ordered.length !== nodes.size)
    throw new WorkError('CYCLE', 'Planning requires an acyclic dependency graph.');
  for (let at = ordered.length - 1; at >= 0; at--) {
    const node = nodes.get(ordered[at]!)!;
    for (const id of node.after) {
      const child = nodes.get(id)!;
      if (isFinished(child.item) || child.item.archived) continue;
      node.priority = Math.max(node.priority, child.priority);
      if (preferred.has(id))
        preferred.set(
          node.item.id,
          Math.min(preferred.get(node.item.id) ?? Infinity, preferred.get(id)!),
        );
      if (child.deadline && (!node.deadline || child.deadline < node.deadline))
        node.deadline = child.deadline;
    }
    node.pending = node.needs.filter((id) => !isFinished(nodes.get(id)!.item)).length;
    node.conditional = node.pending > 0;
  }
  const bounds = new Map<string, { start: number; end: number }>();
  const bound = (date: string) => {
    let value = bounds.get(date);
    if (!value) {
      value = planDayBounds(date, options.timeZone);
      bounds.set(date, value);
    }
    return value;
  };
  const fixed = [...nodes.values()].filter((node) => node.item.schedule);
  const ready = new Set<string>();
  const future = new Heap<{ id: string; at: number }>(
    (a, b) => a.at < b.at || (a.at === b.at && a.id < b.id),
  );
  const endings = new Heap<{ id: string; at: number }>(
    (a, b) => a.at < b.at || (a.at === b.at && a.id < b.id),
  );
  const issues = new Map<string, 'past_slot' | 'prerequisite_timing' | 'packet'>();

  // Only projected task status changes here; actual checks, files and worker access stay real.
  const projectedState = { ...state, items: state.items.map((item) => ({ ...item })) };
  const projectedItems = new Map(projectedState.items.map((item) => [item.id, item]));

  let cursor = now;
  const enqueue = (id: string) => {
    const node = nodes.get(id)!;
    const packet = latestPacket(state, id);
    if (packet?.execution) node.packetBlocked = !packetActionable(projectedState, packet, worker);
    if (
      node.item.kind !== 'task' ||
      node.item.archived ||
      isFinished(node.item) ||
      node.pending ||
      node.packetBlocked
    )
      return;
    if (node.item.schedule) {
      const start = Date.parse(node.item.schedule.start),
        end = Date.parse(node.item.schedule.end);
      if (end <= now) {
        issues.set(id, 'past_slot');
        return;
      }
      if (node.needs.some((need) => nodes.get(need)!.finish > start)) {
        issues.set(id, 'prerequisite_timing');
        return;
      }
      endings.push({ id, at: end });
    } else
      future.push({
        id,
        at: Math.max(cursor, defers.has(id) ? bound(defers.get(id)!).start : now),
      });
  };
  const finish = (id: string, at: number) => {
    const node = nodes.get(id)!;
    node.finish = at;
    projectedItems.get(id)!.status = 'done';
    for (const child of node.after) {
      const target = nodes.get(child)!;
      target.pending--;
      if (!target.pending) enqueue(child);
    }
  };
  const advance = (at: number) => {
    cursor = at;
    while (endings.peek() && endings.peek()!.at <= cursor) {
      const end = endings.pop()!;
      finish(end.id, end.at);
    }
    while (future.peek() && future.peek()!.at <= cursor) ready.add(future.pop()!.id);
  };
  for (const [id, node] of nodes) if (!node.pending) enqueue(id);
  const result: WorkPlan = {
    schemaVersion: 1,
    workspaceId: state.workspace.id,
    revision: state.workspace.revision,
    generatedAt: options.now,
    timeZone: options.timeZone,
    today,
    days: [],
    unplaced: [],
    scheduleIssues: [],
    counts: { openTasks: 0, fixed: 0, fullyProjected: 0, partiallyProjected: 0, unplaced: 0 },
  };
  for (let offset = 0; offset < count; offset++) {
    const date = shiftPlanDate(today, offset),
      { start, end } = bound(date),
      from = Math.max(start, now);
    const workDay = workDays.includes(new Date(`${date}T12:00:00Z`).getUTCDay());
    const day: PlanDay = {
      date,
      workDay,
      capacityMinutes: 0,
      loggedMinutes: logged[date] ?? 0,
      plannedMinutes: 0,
      freeMinutes: 0,
      overlapMinutes: 0,
      suggestionLimitReached: false,
      suggestions: [],
      commitments: [],
      deadlines: [],
    };
    const points = new Map<number, number>();
    for (const node of fixed) {
      const schedule = node.item.schedule!,
        a = Date.parse(schedule.start),
        b = Date.parse(schedule.end);
      if (a < end && b > start) {
        day.commitments.push({
          id: node.item.id,
          start: schedule.start,
          end: schedule.end,
          needsFirst: (node.conditional || node.packetBlocked) && !isFinished(node.item),
        });
        if (node.item.status !== 'cancelled') {
          const lo = Math.max(from, a),
            hi = Math.min(end, b);
          if (hi > lo) {
            points.set(lo, (points.get(lo) ?? 0) + 1);
            points.set(hi, (points.get(hi) ?? 0) - 1);
          }
        }
      }
    }
    const windows: { start: number; end: number }[] = [];
    let depth = 0,
      position = from;
    for (const [at, delta] of [...points].sort(([a], [b]) => a - b)) {
      if (!depth && at > position) windows.push({ start: position, end: at });
      if (depth > 1) day.overlapMinutes += (at - position) / 60000;
      depth += delta;
      position = at;
    }
    if (position < end) windows.push({ start: position, end });
    day.freeMinutes = Math.floor(
      windows.reduce((sum, interval) => sum + interval.end - interval.start, 0) / 60000,
    );
    const capacity =
      offset === 0 && options.todayMinutes !== undefined
        ? options.todayMinutes
        : workDay
          ? Math.max(0, daily - day.loggedMinutes)
          : 0;
    day.capacityMinutes = Math.min(capacity, day.freeMinutes);
    const soon = shiftPlanDate(date, 7);
    const urgency = (node: Node) =>
      node.deadline ? (node.deadline <= date ? 2 : node.deadline <= soon ? 1 : 0) : 0;
    const compare = (a: string, b: string) => {
      const x = nodes.get(a)!,
        y = nodes.get(b)!;
      return (
        (preferred.get(a) ?? Infinity) - (preferred.get(b) ?? Infinity) ||
        urgency(y) - urgency(x) ||
        Number(y.item.status === 'active') - Number(x.item.status === 'active') ||
        y.priority - x.priority ||
        y.after.length - x.after.length ||
        compareText(x.deadline ?? '9999', y.deadline ?? '9999') ||
        compareText(x.item.createdAt, y.item.createdAt) ||
        compareText(a, b)
      );
    };
    for (const interval of windows) {
      advance(interval.start);
      const queue = new Heap<string>((a, b) => compare(a, b) < 0);
      ready.forEach((id) => queue.push(id));
      while (
        cursor < interval.end &&
        day.plannedMinutes < day.capacityMinutes &&
        day.suggestions.length < 100
      ) {
        const before = new Set(ready);
        advance(cursor);
        for (const id of ready) if (!before.has(id)) queue.push(id);
        const id = queue.pop();
        if (!id) {
          const next = Math.min(future.peek()?.at ?? Infinity, endings.peek()?.at ?? Infinity);
          if (next >= interval.end || next <= cursor) break;
          advance(next);
          ready.forEach((id) => queue.push(id));
          continue;
        }
        if (!ready.delete(id)) continue;
        const node = nodes.get(id)!;
        const minutes = Math.min(
          node.left,
          block,
          day.capacityMinutes - day.plannedMinutes,
          Math.floor((interval.end - cursor) / 60000),
        );
        if (minutes < 1) {
          ready.add(id);
          break;
        }
        const suggestion: PlanSuggestion = {
          id,
          minutes,
          order: day.suggestions.length + 1,
          reason: preferred.has(id)
            ? 'chosen'
            : urgency(node)
              ? 'deadline'
              : node.item.status === 'active' || node.allocated
                ? 'continue'
                : node.priority >= 2
                  ? 'priority'
                  : node.after.length
                    ? 'unlocks'
                    : 'ready',
          estimated: node.estimated,
          continuation: node.allocated > 0 || planningProgress(node.item).minutes > 0,
          conditional: node.conditional,
          completesEstimate: minutes === node.left,
          deadline: node.deadline,
          late: !!node.deadline && node.deadline < date,
        };
        day.suggestions.push(suggestion);
        day.plannedMinutes += minutes;
        node.left -= minutes;
        node.allocated += minutes;
        cursor += minutes * 60000;
        if (!node.left) {
          finish(id, cursor);
          const old = new Set(ready);
          advance(cursor);
          for (const added of ready) if (!old.has(added)) queue.push(added);
        } else {
          ready.add(id);
          queue.push(id);
        }
      }
    }
    advance(end);
    day.suggestionLimitReached =
      day.suggestions.length === 100 && day.plannedMinutes < day.capacityMinutes;
    day.deadlines = state.items.filter((item) => item.dueDate === date).map((item) => item.id);
    day.commitments.sort((a, b) => compareText(a.start, b.start) || compareText(a.id, b.id));
    result.days.push(day);
  }
  for (const [id, node] of nodes) {
    if (node.item.kind !== 'task' || node.item.archived || isFinished(node.item)) continue;
    result.counts.openTasks++;
    if (node.item.schedule) {
      result.counts.fixed++;
      if (node.packetBlocked) issues.set(id, 'packet');
      else if (Date.parse(node.item.schedule.end) <= now) issues.set(id, 'past_slot');
      else if (
        node.needs.some((need) => nodes.get(need)!.finish > Date.parse(node.item.schedule!.start))
      )
        issues.set(id, 'prerequisite_timing');
    } else if (!node.left) result.counts.fullyProjected++;
    else {
      if (node.allocated) result.counts.partiallyProjected++;
      else result.counts.unplaced++;
      result.unplaced.push({
        id,
        remainingMinutes: node.left,
        reason: node.packetBlocked
          ? 'packet'
          : node.pending
            ? 'prerequisites'
            : defers.has(id) && defers.get(id)! > result.days.at(-1)!.date
              ? 'later'
              : 'capacity',
      });
    }
  }
  result.unplaced.sort((a, b) => compareText(a.id, b.id));
  result.scheduleIssues = [...issues]
    .sort(([a], [b]) => compareText(a, b))
    .map(([id, reason]) => ({ id, reason }));
  return result;
}
