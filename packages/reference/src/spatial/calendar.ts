import { isFinished, logPlanningMinutes, planDate, shiftPlanDate } from '@statework/sdk';
import type {
  Command,
  PlanDay,
  PlanSuggestion,
  SemanticNode,
  WorkItem,
  WorkPlan,
  WorkState,
} from '@statework/sdk';
import {
  calendarDates,
  calendarMonth,
  calendarPlan,
  calendarUsed,
  newCalendarPreferences,
  restoreCalendarPreferences,
} from './calendar-model';
import { resourceFor, semanticNodes, statusCommand } from './model';
import { caseEscape as esc } from './detective-drawing';

export interface CalendarCell {
  date: string;
  today: boolean;
  selected: boolean;
  outside: boolean;
  minutes: number;
  fixed: number;
  due: number;
  done: number;
}
export interface CalendarView {
  title: string;
  selected: string;
  today: string;
  mode: 'month' | 'week';
  cells: CalendarCell[];
  day?: PlanDay;
  cards: { item: WorkItem; suggestion: PlanSuggestion }[];
  page: number;
  pages: number;
  capacity: string;
  summary: string;
  facts: string[];
}
export class WorkCalendar {
  readonly dialog = document.createElement('dialog');
  private state?: WorkState;
  private plan?: WorkPlan;
  private prefs = newCalendarPreferences();
  private nodes: SemanticNode[] = [];
  private mode: 'month' | 'week' = 'month';
  private selected = '';
  private anchor = '';
  private page = 0;
  private reviewPage = 0;
  private lastFocus: HTMLElement | null = null;
  private message = '';
  private saving = false;
  private zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  private currentView?: CalendarView;
  constructor(
    private changed: () => void,
    private select: (id: string) => void,
    private take: (id: string) => void,
    private write: (commands: Command[]) => Promise<void>,
    private canWrite: () => boolean,
  ) {
    this.dialog.id = 'calendar-dialog';
    this.dialog.className = 'calendar-dialog';
    this.dialog.setAttribute('aria-labelledby', 'calendar-title');
    document.body.append(this.dialog);
    this.dialog.addEventListener('click', (event) => {
      const button = (event.target as Element).closest<HTMLElement>('[data-cal]');
      if (button && !button.hasAttribute('disabled')) void this.action(`cal:${button.dataset.cal}`);
    });
    this.dialog.addEventListener('close', () => this.lastFocus?.focus({ preventScroll: true }));
    this.dialog.addEventListener('keydown', (event) => {
      const button = (event.target as Element).closest<HTMLElement>('[data-date]');
      if (!button) return;
      const offset = (
        { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>
      )[event.key];
      if (offset) {
        event.preventDefault();
        void this.action(`cal:day:${shiftPlanDate(button.dataset.date!, offset)}`);
        this.dialog.querySelector<HTMLElement>(`[data-date="${this.selected}"]`)?.focus();
      }
    });
    // A tab left open overnight must show the new day, even without a work mutation.
    setInterval(() => {
      if (this.state && document.visibilityState === 'visible') this.recalculate();
    }, 60000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.state) this.recalculate();
    });
  }
  get view() {
    return this.currentView;
  }
  get dailyMinutes() {
    return this.prefs.dailyMinutes;
  }
  get today() {
    return this.plan?.days[0];
  }
  get next(): WorkItem | undefined {
    const suggestion = this.today?.suggestions.find((s) => !s.conditional);
    return this.state?.items.find((i) => i.id === suggestion?.id);
  }
  setWork(state: WorkState, role: 'owner' | 'editor' | 'reader') {
    if (this.state?.workspace.id !== state.workspace.id) {
      try {
        this.prefs = restoreCalendarPreferences(
          localStorage.getItem(`statework.calendar.${state.workspace.id}`) ?? '',
        );
      } catch {
        this.prefs = newCalendarPreferences();
      }
      this.selected = '';
      this.anchor = '';
      this.page = 0;
    }
    this.state = state;
    this.nodes = semanticNodes(state, role);
    this.recalculate(false);
  }
  clear() {
    this.state = undefined;
    this.plan = undefined;
    this.currentView = undefined;
    this.dialog.close();
  }
  private save() {
    if (this.state)
      try {
        localStorage.setItem(
          `statework.calendar.${this.state.workspace.id}`,
          JSON.stringify(this.prefs),
        );
      } catch {
        this.message = 'Preferences could not be saved in this browser.';
      }
  }
  private recalculate(notify = true) {
    if (!this.state) return;
    const oldToday = this.plan?.today;
    this.plan = calendarPlan(this.state, this.prefs, new Date().toISOString(), this.zone);
    if (!this.selected || (oldToday && this.selected === oldToday && oldToday !== this.plan.today))
      this.selected = this.plan.today;
    if (!this.anchor || (oldToday && this.anchor === oldToday && oldToday !== this.plan.today))
      this.anchor = this.plan.today;
    this.save();
    this.render();
    if (notify) this.changed();
  }
  async action(action: string): Promise<boolean> {
    if (!action.startsWith('cal:')) return false;
    if (!this.state || !this.plan) return true;
    if (planDate(new Date().toISOString(), this.zone) !== this.plan.today) this.recalculate(false);
    const [kind, arg, extra] = action.slice(4).split(':');
    if (kind === 'open-view') {
      this.recalculate();
      this.lastFocus = document.activeElement as HTMLElement;
      this.dialog.showModal();
      return true;
    }
    if (kind === 'close') {
      this.dialog.close();
      return true;
    }
    if (kind === 'day' && arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) {
      this.selected = arg;
      if (!calendarDates(this.anchor, this.mode).includes(arg)) this.anchor = arg;
      this.page = 0;
    } else if (kind === 'today') {
      this.selected = this.plan.today;
      this.anchor = this.selected;
      this.page = 0;
    } else if (kind === 'mode' && (arg === 'month' || arg === 'week')) {
      this.mode = arg;
      this.anchor = this.selected;
    } else if (kind === 'previous' || kind === 'next') {
      this.anchor =
        this.mode === 'month'
          ? calendarMonth(this.anchor, kind === 'next' ? 1 : -1)
          : shiftPlanDate(this.anchor, kind === 'next' ? 7 : -7);
      this.selected = this.anchor;
      this.page = 0;
    } else if (kind === 'page') {
      this.page += arg === 'next' ? 1 : -1;
    } else if (kind === 'review-page') {
      this.reviewPage += arg === 'next' ? 1 : -1;
    } else if (kind === 'capacity' && [0, 30, 60, 120, 240].includes(Number(arg))) {
      this.prefs.override = { minutes: Number(arg), used: calendarUsed(this.state, this.prefs) };
      this.selected = this.plan.today;
      this.anchor = this.selected;
      this.page = 0;
    } else if (kind === 'daily' && [60, 120, 240, 360, 480].includes(Number(arg))) {
      this.prefs.dailyMinutes = Number(arg);
      this.prefs.override = null;
    } else if (kind === 'weekday' && Number(arg) >= 0 && Number(arg) <= 6) {
      const day = Number(arg);
      this.prefs.workDays = this.prefs.workDays.includes(day)
        ? this.prefs.workDays.filter((d) => d !== day)
        : [...this.prefs.workDays, day];
      this.prefs.override = null;
    } else if (kind === 'defer' && arg) {
      this.prefs.notBefore[arg] = shiftPlanDate(this.plan.today, extra === 'week' ? 7 : 1);
      this.prefs.preferred = this.prefs.preferred.filter((id) => id !== arg);
    } else if (kind === 'choose' && arg) {
      delete this.prefs.notBefore[arg];
      this.prefs.preferred = [arg, ...this.prefs.preferred.filter((id) => id !== arg)];
      this.selected = this.plan.today;
      this.anchor = this.selected;
      this.page = 0;
    } else if (kind === 'reset-choices') {
      this.prefs.notBefore = Object.create(null);
      this.prefs.preferred = [];
    } else if ((kind === 'file' || kind === 'hold') && arg) {
      this.dialog.close();
      kind === 'hold' ? this.take(arg) : this.select(arg);
      return true;
    } else if (['log', 'finish', 'start'].includes(kind ?? '') && arg) {
      const item = this.state.items.find((i) => i.id === arg),
        node = this.nodes.find((n) => n.id === arg);
      if (!item || !node || !this.canWrite() || this.saving) return true;
      const ready = !node.relationships.some(
        (r) =>
          r.kind === 'depends_on' &&
          r.direction === 'outgoing' &&
          !isFinished(this.state!.items.find((i) => i.id === r.targetId)!),
      );
      if (!ready || isFinished(item)) {
        this.message = 'Finish the prerequisites first.';
        this.render();
        return true;
      }
      const command =
        kind === 'log'
          ? logPlanningMinutes(item, this.plan.today, Number(extra))
          : statusCommand(item, kind === 'finish' ? 'done' : 'active');
      this.saving = true;
      this.message = 'Saving…';
      this.render();
      try {
        await this.write([command]);
        this.message = kind === 'log' ? `${extra} minutes recorded.` : 'Saved.';
      } catch (error) {
        this.message =
          error instanceof Error ? error.message : 'Save failed. Review the main save status.';
      } finally {
        this.saving = false;
        this.render();
        this.changed();
      }
      return true;
    }
    this.recalculate();
    return true;
  }
  private button(action: string, label: string, disabled = false, pressed?: boolean) {
    return `<button data-cal="${esc(action)}" ${disabled ? 'disabled' : ''} ${pressed === undefined ? '' : `aria-pressed="${pressed}"`}>${label}</button>`;
  }
  private card(item: WorkItem, s?: PlanSuggestion) {
    const node = this.nodes.find((n) => n.id === item.id);
    const requirements =
      node?.relationships.filter(
        (r) =>
          r.kind === 'depends_on' &&
          r.direction === 'outgoing' &&
          !isFinished(this.state!.items.find((i) => i.id === r.targetId)!),
      ) ?? [];
    const link = resourceFor(item),
      disabled = !this.canWrite() || this.saving || isFinished(item) || requirements.length > 0;
    return `<article class="cal-task ${requirements.length ? 'cal-blocked' : ''}"><div class="cal-task-head"><span class="cal-order">${s?.order ?? (isFinished(item) ? '✓' : '◇')}</span><div><h3>${esc(item.title)}</h3><p>${s ? `${s.estimated ? '≈ ' : ''}${s.minutes}m · ${s.conditional ? '◇ After prerequisites' : s.continuation ? '◐ Continue' : '○ Ready'}${s.late ? (s.deadline === item.dueDate ? ' · Past due' : ' · Overdue dependent') : ''}` : esc(item.status)}</p></div></div><div class="cal-actions">${this.button(`file:${item.id}`, 'Open file')}${this.button(`hold:${item.id}`, 'Hold file')}${link ? `<a class="button" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Resource ↗</a>` : ''}</div>${requirements.length ? `<div class="cal-requirements"><span>◇ Needs first</span>${requirements.map((r) => this.button(`file:${r.targetId}`, esc(r.targetLabel))).join('')}</div>` : ''}${s ? `<div class="cal-actions">${this.button(`start:${item.id}`, '▶ Start', disabled || item.status === 'active')}${this.button(`log:${item.id}:${s.minutes}`, `+ ${s.minutes}m worked`, disabled)}${this.button(`finish:${item.id}`, '✓ Finish', disabled)}</div><div class="cal-actions cal-secondary">${this.button(`choose:${item.id}`, '↑ Do next')}${this.button(`defer:${item.id}`, 'Tomorrow →')}${this.button(`defer:${item.id}:week`, 'Next week →')}</div>` : !isFinished(item) ? `<div class="cal-actions">${this.button(`choose:${item.id}`, '↑ Do next')}</div>` : ''}${item.description ? `<details data-cal-detail="notes:${esc(item.id)}"><summary>Notes / microsteps</summary><p class="cal-notes">${esc(item.description)}</p></details>` : ''}</article>`;
  }
  private render() {
    if (!this.state || !this.plan) return;
    const state = this.state,
      plan = this.plan,
      day = plan.days.find((d) => d.date === this.selected);
    const items = new Map(state.items.map((i) => [i.id, i]));
    const dates = calendarDates(this.anchor, this.mode);
    const scheduled = state.items
      .filter((i) => i.schedule)
      .map((item) => ({
        item,
        start: planDate(item.schedule!.start, this.zone),
        end: planDate(Date.parse(item.schedule!.end) - 1, this.zone),
      }));
    const cells = dates.map((date) => {
      const d = plan.days.find((d) => d.date === date);
      const actual = scheduled.filter((s) => s.start <= date && s.end >= date).map((s) => s.item);
      return {
        date,
        today: date === plan.today,
        selected: date === this.selected,
        outside: this.mode === 'month' && date.slice(0, 7) !== this.anchor.slice(0, 7),
        minutes: d?.plannedMinutes ?? 0,
        fixed: actual.length,
        due: state.items.filter((i) => i.dueDate === date && !isFinished(i)).length,
        done: actual.filter(isFinished).length,
      };
    });
    const suggestions = day?.suggestions ?? [],
      pages = Math.max(1, Math.ceil(suggestions.length / 3));
    this.page = Math.max(0, Math.min(this.page, pages - 1));
    const dateLabel = (date: string, options: Intl.DateTimeFormatOptions) =>
      new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, { ...options, timeZone: 'UTC' });
    const title =
      this.mode === 'month'
        ? dateLabel(this.anchor, { month: 'long', year: 'numeric' })
        : `${dateLabel(dates[0]!, { month: 'short', day: 'numeric' })} – ${dateLabel(dates[6]!, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    const capacity = day
      ? `${day.plannedMinutes} / ${day.capacityMinutes}m planned`
      : 'Actual records';
    const summary = day
      ? !day.capacityMinutes
        ? 'Rest / day full'
        : !suggestions.length
          ? 'Review needs first'
          : 'Suggested order · flexible'
      : 'Outside 90-day forecast';
    this.currentView = {
      title,
      selected: this.selected,
      today: plan.today,
      mode: this.mode,
      cells,
      day,
      cards: suggestions
        .slice(this.page * 3, this.page * 3 + 3)
        .map((s) => ({ item: items.get(s.id)!, suggestion: s })),
      page: this.page,
      pages,
      capacity,
      summary,
      facts: [],
    };
    const active = (document.activeElement as HTMLElement)?.closest<HTMLElement>('[data-cal]')
      ?.dataset.cal;
    const appointments = scheduled
      .filter((s) => s.start <= this.selected && s.end >= this.selected)
      .map((s) => s.item);
    const deadlines = state.items.filter((i) => i.dueDate === this.selected);
    const time = (instant: string) =>
      new Date(instant).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: this.zone,
      });
    this.currentView.facts = [
      ...appointments.map((i) => `▣ ${i.title}`),
      ...deadlines.filter((i) => !isFinished(i)).map((i) => `◆ ${i.title}`),
    ];
    const review = [
      ...plan.scheduleIssues.map((i) => ({
        id: i.id,
        label: i.reason === 'past_slot' ? 'Past appointment' : 'Prerequisites miss appointment',
      })),
      ...plan.unplaced.map((i) => ({ id: i.id, label: `${i.remainingMinutes}m · ${i.reason}` })),
    ];
    const reviewPages = Math.max(1, Math.ceil(review.length / 40));
    this.reviewPage = Math.max(0, Math.min(this.reviewPage, reviewPages - 1));
    const expanded = [
      ...this.dialog.querySelectorAll<HTMLDetailsElement>('[data-cal-detail][open]'),
    ].map((el) => el.dataset.calDetail!);
    this.dialog.innerHTML = `<div class="cal-shell"><header class="cal-header"><div><p class="eyebrow">YOUR DAYS · ${esc(this.zone)}</p><h2 id="calendar-title">${esc(title)}</h2></div>${this.button('close', '× Close')}</header><div class="cal-toolbar" aria-label="Calendar navigation">${this.button('previous', '← Previous')}${this.button('today', 'Today')}${this.button('next', 'Next →')}${this.button('mode:month', 'Month', false, this.mode === 'month')}${this.button('mode:week', 'Week', false, this.mode === 'week')}</div><div class="cal-layout"><div class="cal-overview"><div class="cal-weekdays" aria-hidden="true">${['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((d) => `<span>${d}</span>`).join('')}</div><div class="cal-grid ${this.mode === 'week' ? 'cal-week' : ''}" role="group" aria-label="Calendar days. Arrow keys move by day or week.">${cells.map((c) => `<button data-cal="day:${c.date}" data-date="${c.date}" aria-pressed="${c.selected}" aria-label="${c.date}${c.today ? ', today' : ''}, ${c.minutes} minutes suggested, ${c.fixed} appointments, ${c.due} deadlines" class="cal-cell ${c.today ? 'cal-today' : ''} ${c.outside ? 'cal-outside' : ''}"><strong>${Number(c.date.slice(8))}</strong>${c.today ? '<small>Today</small>' : ''}<div class="cal-marks">${c.minutes ? `<span class="cal-suggest">○ ${c.minutes}m</span>` : ''}${c.fixed ? `<span class="cal-fixed">▣ ${c.fixed}</span>` : ''}${c.due ? `<span class="cal-due">◆ ${c.due}</span>` : ''}${c.done ? `<span>✓ ${c.done}</span>` : ''}</div></button>`).join('')}</div><p class="cal-key">○ Suggested · ▣ Appointment · ◆ Due · ✓ Recorded done</p><section class="cal-capacity"><h3>Time left today</h3><div class="cal-actions">${[
      [30, '30m'],
      [60, '1h'],
      [120, '2h'],
      [240, '4h'],
      [0, 'Day off'],
    ]
      .map(([n, label]) =>
        this.button(`capacity:${n}`, String(label), false, this.prefs.override?.minutes === n),
      )
      .join(
        '',
      )}</div><p>${plan.days[0]!.plannedMinutes}m suggested · ${plan.days[0]!.loggedMinutes}m recorded</p><details data-cal-detail="week"><summary>My week · ${this.prefs.dailyMinutes / 60}h / day</summary><div class="cal-actions">${[
      [1, 'Mon'],
      [2, 'Tue'],
      [3, 'Wed'],
      [4, 'Thu'],
      [5, 'Fri'],
      [6, 'Sat'],
      [0, 'Sun'],
    ]
      .map(([n, label]) =>
        this.button(`weekday:${n}`, String(label), false, this.prefs.workDays.includes(Number(n))),
      )
      .join(
        '',
      )}</div><div class="cal-actions">${[60, 120, 240, 360, 480].map((n) => this.button(`daily:${n}`, `${n / 60}h`, false, this.prefs.dailyMinutes === n)).join('')}</div>${this.button('reset-choices', 'Reset defers / choices')}<p>Focus time outside appointments. Unknown estimates use ≈30m. Suggestions assume prerequisites finish; actual work stays unchanged. Finished allocations use today's budget; only “worked” records time.</p></details></section><details class="cal-unplaced" data-cal-detail="review"><summary>Needs review · ${plan.unplaced.length + plan.scheduleIssues.length}</summary><p>Unplaced or partly planned within 90 days. Open a file to change its estimate, requirement or fixed schedule in Classic views.</p>${this.button('review-page:previous', '← Review', this.reviewPage === 0)} ${this.reviewPage + 1} / ${reviewPages} ${this.button('review-page:next', 'Review →', this.reviewPage + 1 >= reviewPages)}${review
      .slice(this.reviewPage * 40, this.reviewPage * 40 + 40)
      .map(
        (i) =>
          `<div class="cal-review-row">${this.button(`file:${i.id}`, esc(items.get(i.id)!.title))}<span>${esc(i.label)}</span>${this.button(`choose:${i.id}`, '↑ Next')}</div>`,
      )
      .join(
        '',
      )}</details></div><section class="cal-day" aria-label="Selected day"><p class="eyebrow">${this.selected === plan.today ? 'TODAY → NEXT' : esc(dateLabel(this.selected, { weekday: 'long', month: 'short', day: 'numeric' }))}</p><h2>${esc(capacity)}</h2><p>${esc(summary)}</p>${day?.overlapMinutes ? `<p class="cal-alert">▣ Appointments overlap · ${Math.ceil(day.overlapMinutes)}m</p>` : ''}${appointments.length ? `<h3>▣ Fixed appointments</h3>${appointments.map((i) => `<div class="cal-appointment">${this.button(`file:${i.id}`, esc(i.title))}<span>${esc(time(i.schedule!.start))} → ${esc(time(i.schedule!.end))} · ${esc(i.status)}</span></div>`).join('')}` : ''}${deadlines.length ? `<h3>◆ Due</h3>${deadlines.map((i) => this.button(`file:${i.id}`, `${isFinished(i) ? '✓ ' : ''}${esc(i.title)}`)).join('')}` : ''}${suggestions.length ? `<h3>○ Suggested order</h3>${suggestions.map((s) => this.card(items.get(s.id)!, s)).join('')}` : `<div class="cal-empty">${!day ? 'Past records and future facts stay visible.' : !day.capacityMinutes ? '✓ Leave room to rest.' : '◇ No ready suggestion. Open Needs review.'}</div>`}${day?.suggestionLimitReached ? '<p>100-block display limit reached. Remaining work is in Needs review.</p>' : ''}</section></div><p class="cal-status" role="status">${esc(this.message)}</p></div>`;
    for (const key of expanded) {
      const detail = this.dialog.querySelector<HTMLDetailsElement>(
        `[data-cal-detail="${CSS.escape(key)}"]`,
      );
      if (detail) detail.open = true;
    }
    if (active)
      this.dialog
        .querySelector<HTMLElement>(`[data-cal="${CSS.escape(active)}"]`)
        ?.focus({ preventScroll: true });
  }
}
