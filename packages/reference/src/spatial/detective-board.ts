import type { WorkState } from '@statework/sdk';
import {
  caseGraph,
  caseLeads,
  caseMarks,
  caseTransition,
  newCaseSession,
  projectCase,
  restoreCaseSession,
} from './detective-model';
import type {
  CaseBoard,
  CaseFilter,
  CaseGraph,
  CaseIntent,
  CaseLens,
  CaseSession,
} from './detective-model';
import { caseEscape as esc, caseSvg } from './detective-drawing';
import { resourceFor } from './model';

export interface DetectiveView {
  board: CaseBoard;
  session: CaseSession;
  pins: { id: string; label: string }[];
  trail: { id: string; label: string }[];
}
export class DetectiveBoard {
  readonly dialog = document.createElement('dialog');
  private graph?: CaseGraph;
  private session = newCaseSession('');
  private board?: CaseBoard;
  private leads: ReturnType<typeof caseLeads> = [];
  private zoom = 1;
  private fitting = true;
  private lastFocus: HTMLElement | null = null;
  private drag: { x: number; y: number; left: number; top: number } | null = null;
  private resize: ResizeObserver;
  private message = '';
  constructor(
    private changed: () => void,
    private select: (id: string) => void,
    private take: (id: string) => void,
  ) {
    this.dialog.id = 'detective-dialog';
    this.dialog.className = 'detective-dialog';
    this.dialog.setAttribute('aria-labelledby', 'case-title');
    this.dialog.innerHTML = `<div class="case-shell"><header class="case-header"><div><p class="eyebrow">DETECTIVE BOARD</p><h2 id="case-title">The whole case</h2><p id="case-coverage"></p></div><button data-case="close" aria-label="Close detective board">×</button></header><div class="case-toolbar" role="group" aria-label="Investigation controls"><button data-case="overview">▦ Whole case</button><button data-case="back">← Back</button><button data-case="lens:requirements">◇ Needs first</button><button data-case="lens:impact">↗ What follows</button><button data-case="lens:unblock">⚿ Unblock</button><button data-case="context" id="case-context" aria-pressed="true">Parent + related links</button><label class="case-search"><span class="sr-only">Find on detective board</span><input id="case-search" type="search" maxlength="240" placeholder="Find a file…"></label><label class="sr-only" for="case-filter">Board records</label><select id="case-filter"><option value="all">All records</option><option value="open">Open work</option><option value="finished">Finished</option><option value="archived">Archived</option></select></div><div class="case-main"><div class="case-map-column"><div id="case-stats" class="case-stats"></div><div id="case-viewport" class="case-viewport" tabindex="0" aria-label="Investigation map. Arrow keys pan; plus and minus zoom; zero fits."><div id="case-map"></div></div><div class="case-map-tools" role="group" aria-label="Board view controls"><button data-case="zoom-out" aria-label="Zoom out board">−</button><span id="case-zoom">100%</span><button data-case="zoom-in" aria-label="Zoom in board">＋</button><button data-case="fit">Fit all</button><button data-case="pan-left" aria-label="Pan board left">←</button><button data-case="pan-up" aria-label="Pan board up">↑</button><button data-case="pan-down" aria-label="Pan board down">↓</button><button data-case="pan-right" aria-label="Pan board right">→</button><span class="case-thread-key">→ Needs first to work · – – Parent · · · Related</span></div><p id="case-note" class="case-note" role="status"></p><details class="case-list"><summary>Files & groups · text controls</summary><div id="case-list"></div></details></div><aside class="case-sidebar" aria-label="Investigation memory"><div id="case-mini"></div><section id="case-focus"></section><section><h3>★ Keep in sight <small id="case-pin-count"></small></h3><div id="case-pins" class="case-chips"></div></section><section><h3>← Your trail</h3><div id="case-trail" class="case-chips"></div></section><section><h3>⚿ Best leads</h3><p class="case-small">Open now = direct work unblocked by finishing this. Reach = unfinished work further along.</p><div id="case-leads"></div><button data-case="lens:unblock">See every lead</button></section></aside></div></div>`;
    document.body.append(this.dialog);
    this.dialog.addEventListener('click', (event) => {
      const target = event.target as Element;
      const card = target.closest<HTMLElement>('[data-case-card]');
      if (card) this.action(`board:open:${encodeURIComponent(card.dataset.caseCard!)}`);
      else {
        const button = target.closest<HTMLElement>('[data-case]');
        if (button) {
          button.focus({ preventScroll: true });
          this.action(`board:${button.dataset.case}`);
        }
      }
    });
    this.dialog.addEventListener('keydown', (event) => {
      const target = event.target as Element;
      if (target.closest('[data-case-card]') && ['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        (target.closest('[data-case-card]') as HTMLElement).dispatchEvent(
          new MouseEvent('click', { bubbles: true }),
        );
      }
      if (target.id !== 'case-viewport') return;
      const actions: Record<string, string> = {
        ArrowLeft: 'pan-left',
        ArrowRight: 'pan-right',
        ArrowUp: 'pan-up',
        ArrowDown: 'pan-down',
        '+': 'zoom-in',
        '=': 'zoom-in',
        '-': 'zoom-out',
        '0': 'fit',
      };
      if (actions[event.key]) {
        event.preventDefault();
        this.action(`board:${actions[event.key]}`);
      }
    });
    this.el<HTMLInputElement>('#case-search').addEventListener('input', (event) =>
      this.dispatch({ type: 'query', query: (event.target as HTMLInputElement).value }, true),
    );
    this.el<HTMLSelectElement>('#case-filter').addEventListener('change', (event) =>
      this.dispatch(
        { type: 'filter', filter: (event.target as HTMLSelectElement).value as CaseFilter },
        true,
      ),
    );
    const viewport = this.el('#case-viewport');
    viewport.addEventListener('pointerdown', (event) => {
      if (
        event.pointerType === 'touch' ||
        event.button !== 0 ||
        (event.target as Element).closest('[data-case-card]')
      )
        return;
      this.drag = {
        x: event.clientX,
        y: event.clientY,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
      };
      viewport.setPointerCapture(event.pointerId);
    });
    viewport.addEventListener('pointermove', (event) => {
      if (this.drag) {
        viewport.scrollLeft = this.drag.left - event.clientX + this.drag.x;
        viewport.scrollTop = this.drag.top - event.clientY + this.drag.y;
      }
    });
    for (const type of ['pointerup', 'pointercancel'])
      viewport.addEventListener(type, () => {
        this.drag = null;
      });
    this.dialog.addEventListener('close', () => {
      this.drag = null;
      this.lastFocus?.focus();
    });
    this.resize = new ResizeObserver(() => {
      if (this.dialog.open && this.fitting) this.fit();
    });
    this.resize.observe(viewport);
  }
  private el<T extends HTMLElement = HTMLElement>(selector: string): T {
    return this.dialog.querySelector<T>(selector)!;
  }
  get view(): DetectiveView | undefined {
    if (!this.board || !this.graph) return undefined;
    const labels = (ids: string[]) =>
      ids.map((id) => ({ id, label: this.graph!.records.get(id)!.item.title }));
    return {
      board: this.board,
      session: this.session,
      pins: labels(this.session.pins),
      trail: labels(this.session.trail),
    };
  }
  setWork(state: WorkState) {
    if (
      this.graph?.workspaceId === state.workspace.id &&
      this.graph.revision === state.workspace.revision
    ) {
      // Scheduled starts can become current even when the workspace revision is unchanged.
      this.leads = caseLeads(this.graph, new Date().toISOString());
      this.rebuild();
      return;
    }
    const switched = this.graph?.workspaceId !== state.workspace.id;
    this.graph = caseGraph(state);
    let saved: unknown = this.session;
    if (switched) {
      saved = undefined;
      try {
        saved = JSON.parse(localStorage.getItem(`statework.case.${state.workspace.id}`) ?? 'null');
      } catch {
        /* A corrupt preference cannot affect work. */
      }
    }
    const query = this.session.query;
    this.session = restoreCaseSession(this.graph, saved);
    if (!switched) this.session.query = query;
    this.leads = caseLeads(this.graph, new Date().toISOString());
    this.fitting = true;
    this.rebuild();
  }
  clear() {
    this.graph = undefined;
    this.board = undefined;
    this.session = newCaseSession('');
    this.dialog.close();
  }
  focus(id: string) {
    if (this.graph && this.session.focus !== id && this.graph.records.has(id))
      this.dispatch({ type: 'focus', id });
  }
  private save() {
    try {
      localStorage.setItem(
        `statework.case.${this.session.workspaceId}`,
        JSON.stringify(this.session),
      );
    } catch {
      this.message = 'Memory could not be saved in this browser. Work records are still safe.';
    }
  }
  private dispatch(intent: CaseIntent, fit = false) {
    if (!this.graph) return;
    this.session = caseTransition(this.graph, this.session, intent);
    this.fitting ||= fit;
    this.save();
    this.rebuild();
    this.changed();
  }
  action(action: string): boolean {
    if (!action.startsWith('board:')) return false;
    if (!this.graph || !this.board) return true;
    const id = action.slice(6);
    if (id === 'open-view') {
      this.lastFocus = document.activeElement as HTMLElement;
      if (!this.dialog.open) this.dialog.showModal();
      this.fitting = true;
      this.render();
      this.fit();
      return true;
    }
    if (id === 'close') {
      this.dialog.close();
      return true;
    }
    if (id === 'fit') {
      this.fitting = true;
      this.fit();
      return true;
    }
    if (id.startsWith('zoom-')) {
      this.fitting = false;
      this.zoom = Math.max(0.12, Math.min(8, this.zoom * (id === 'zoom-in' ? 1.35 : 1 / 1.35)));
      this.scale();
      return true;
    }
    if (id.startsWith('pan-')) {
      const viewport = this.el('#case-viewport');
      viewport.scrollLeft += id === 'pan-left' ? -220 : id === 'pan-right' ? 220 : 0;
      viewport.scrollTop += id === 'pan-up' ? -180 : id === 'pan-down' ? 180 : 0;
      return true;
    }
    if (id === 'take' && this.session.focus) {
      this.dialog.close();
      this.take(this.session.focus);
      return true;
    }
    if (id.startsWith('open:')) {
      const card = this.board.cards.find((card) => card.id === decodeURIComponent(id.slice(5)));
      if (card) {
        this.dispatch({ type: 'open', card }, !card.recordId);
        if (card.recordId) this.select(card.recordId);
      }
      return true;
    }
    if (id.startsWith('focus:')) {
      const target = decodeURIComponent(id.slice(6));
      if (this.graph.records.has(target)) {
        this.dispatch({ type: 'focus', id: target });
        this.select(target);
      }
      return true;
    }
    if (id.startsWith('pin:') || id === 'pin') {
      const target = id === 'pin' ? this.session.focus : decodeURIComponent(id.slice(4));
      if (target) {
        this.message =
          this.session.pins.length >= 12 && !this.session.pins.includes(target)
            ? '12 pins in sight. Unpin one before adding another.'
            : '';
        this.dispatch({ type: 'pin', id: target });
      }
      return true;
    }
    if (id.startsWith('lens:')) {
      this.dispatch({ type: 'lens', lens: id.slice(5) as CaseLens }, true);
      return true;
    }
    if (id === 'overview' || id === 'back' || id === 'context') {
      this.message = '';
      this.dispatch({ type: id }, id !== 'context');
      return true;
    }
    return true;
  }
  private rebuild() {
    this.board = projectCase(this.graph!, this.session, this.leads);
    if (this.dialog.open) this.render();
  }
  private render() {
    if (!this.graph || !this.board) return;
    const graph = this.graph,
      board = this.board,
      s = this.session;
    const activeCard = (document.activeElement as HTMLElement)?.dataset?.caseCard;
    const activeControl = (document.activeElement as HTMLElement)?.dataset?.case;
    this.el('#case-title').textContent = board.title;
    this.el('#case-coverage').textContent =
      `${board.counts.total} of ${board.workspaceCounts.total} records · ${board.cards.length} cards · ${board.shownLinks} connections · Revision ${board.revision}`;
    this.el<HTMLInputElement>('#case-search').value = s.query;
    this.el<HTMLSelectElement>('#case-filter').value = s.filter;
    this.el('#case-context').setAttribute('aria-pressed', String(s.showContext));
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-case^="lens:"]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.case === `lens:${s.lens}`));
      if (['lens:requirements', 'lens:impact'].includes(button.dataset.case!))
        button.disabled = !s.focus;
    });
    this.el('#case-stats').innerHTML =
      `<span>○ ${board.counts.ready} ready</span><span>▶ ${board.counts.active} active</span><span>◇ ${board.counts.waiting} need first</span><span>✓ ${board.counts.done} done</span><span>– ${board.counts.cancelled} cancelled</span><span>▤ ${board.counts.archived} archived</span>`;
    this.el('#case-map').innerHTML = caseSvg(board);
    this.el('#case-list').innerHTML = board.cards
      .map(
        (card) =>
          `<button data-case-card="${esc(card.id)}">${esc(card.label)} <small>${card.counts.total} record${card.counts.total === 1 ? '' : 's'} · ${card.internalLinks} internal links</small></button>`,
      )
      .join('');
    this.el('#case-note').textContent =
      this.message ||
      `${s.scope ? `${s.back.map((scope) => scope.label).join(' → ')}${s.back.length ? ' → ' : ''}${s.scope.label}. ` : ''}${board.counts.total === board.workspaceCounts.total ? 'Every record is represented.' : 'Narrowed view. Whole case restores all records.'} ${board.outsideLinks ? `${board.outsideLinks} connections continue outside this view.` : ''} Group cards keep their internal connections; open a card to see them.`;
    const whole = projectCase(graph, newCaseSession(graph.workspaceId), this.leads),
      scope = new Set(board.cards.flatMap((card) => card.ids));
    this.el('#case-mini').innerHTML =
      `<button data-case="overview" class="case-mini" aria-label="Return to whole case overview"><svg viewBox="0 0 ${whole.width} ${whole.height}" aria-hidden="true">${whole.cards.map((card) => `<rect x="${card.x}" y="${card.y}" width="${card.width}" height="${card.height}" rx="10" fill="${card.ids.some((id) => scope.has(id)) ? '#a8dbc5' : '#4d6057'}"/>`).join('')}</svg><span>Whole case · ${whole.counts.total}</span></button>`;
    const record = board.focus;
    const focusButton = (id: string) => {
      const r = graph.records.get(id)!;
      return `<button data-case="focus:${encodeURIComponent(id)}">${esc(caseMarks[r.mark].symbol)} ${esc(r.item.title)}</button>`;
    };
    if (record) {
      const source = resourceFor(record.item);
      this.el('#case-focus').innerHTML =
        `<p class="eyebrow">SELECTED FILE</p><h3>${esc(record.item.title)}</h3><p class="case-fact">${caseMarks[record.mark].symbol} ${esc(caseMarks[record.mark].label)}${record.item.archived ? ' · Archived' : ''}</p><div class="case-actions"><button data-case="pin" aria-pressed="${s.pins.includes(record.item.id)}">${s.pins.includes(record.item.id) ? '★ Unpin' : '☆ Pin file'}</button><button data-case="take">Hold folder</button>${source ? `<a class="button" href="${esc(source)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>` : ''}</div><div class="case-focus-counts"><button data-case="lens:requirements"><b>${board.requirements}</b> before this</button><button data-case="lens:impact"><b>${board.impact}</b> after this</button></div>${record.item.dueDate ? `<p>Due ${esc(record.item.dueDate)}</p>` : ''}${record.item.effortMinutes ? `<p>${record.item.effortMinutes} minutes</p>` : ''}<details><summary>Notes / microsteps</summary><p class="case-notes">${esc(record.item.description || 'No notes recorded.')}</p></details><details><summary>Direct requirements · ${record.needs.length}</summary><div class="case-chips">${record.needs.slice(0, 8).map(focusButton).join('')}${record.needs.length > 8 ? `<button data-case="lens:requirements">All ${record.needs.length} requirements →</button>` : ''}</div></details>`;
    } else
      this.el('#case-focus').innerHTML =
        '<h3>Pick a card.</h3><p class="case-small">See its requirements. Follow its impact. Pin what you want to remember.</p>';
    this.el('#case-pin-count').textContent = `${s.pins.length}/12`;
    this.el('#case-pins').innerHTML = s.pins.length
      ? s.pins
          .map(
            (id) =>
              `<div class="case-pin-row">${focusButton(id)}<button data-case="pin:${encodeURIComponent(id)}" aria-label="${esc(`Unpin ${graph.records.get(id)!.item.title}`)}">×</button></div>`,
          )
          .join('')
      : '<p class="case-small">Pin a file with one click. Pins stay here when you return.</p>';
    this.el('#case-trail').innerHTML = s.trail.length
      ? [...s.trail].reverse().map(focusButton).join('')
      : '<p class="case-small">Your route appears here as you follow files.</p>';
    this.el('#case-leads').innerHTML =
      this.leads
        .slice(0, 5)
        .map(
          (lead) =>
            `<button data-case="focus:${encodeURIComponent(lead.id)}" class="case-lead"><strong>${esc(graph.records.get(lead.id)!.item.title)}</strong><span>${lead.opens} open now · ${lead.reaches} reach${lead.archived ? ' · Archived' : ''}</span></button>`,
        )
        .join('') || '<p class="case-small">No unresolved prerequisite leads in this snapshot.</p>';
    if (this.fitting) this.fit();
    else this.scale();
    if (activeCard)
      this.dialog
        .querySelector<HTMLElement>(`[data-case-card="${CSS.escape(activeCard)}"]`)
        ?.focus({ preventScroll: true });
    else if (activeControl)
      this.dialog
        .querySelector<HTMLElement>(`[data-case="${CSS.escape(activeControl)}"]`)
        ?.focus({ preventScroll: true });
  }
  private fit() {
    if (!this.board || !this.dialog.open) return;
    const viewport = this.el('#case-viewport');
    this.zoom = Math.max(
      0.12,
      Math.min(
        2,
        (viewport.clientWidth - 8) / this.board.width,
        (viewport.clientHeight - 8) / this.board.height,
      ),
    );
    this.scale();
    viewport.scrollLeft = viewport.scrollTop = 0;
  }
  private scale() {
    if (!this.board) return;
    const map = this.el('#case-map');
    map.style.width = `${this.board.width * this.zoom}px`;
    map.style.height = `${this.board.height * this.zoom}px`;
    this.el('#case-zoom').textContent = `${Math.round(this.zoom * 100)}%`;
  }
  dispose() {
    this.resize.disconnect();
    this.dialog.remove();
  }
}
