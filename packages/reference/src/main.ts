import {
  WorkClient,
  WorkError,
  defaultProfile,
  textAdapter,
  spatialAdapter,
  perceptionProfileSchema,
} from '@statework/sdk';
import type {
  WorkState,
  WorkItem,
  Query,
  Command,
  Observation,
  PerceptionProfile,
  Status,
} from '@statework/sdk';
import './style.css';

const root = document.querySelector<HTMLDivElement>('#app')!;
const esc = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const uid = () => crypto.randomUUID();
const icon = (name: string) =>
  ({ list: '≡', board: '▥', timeline: '↔', map: '⌘', focus: '◉', text: '¶' })[name] ?? '◇';
let profile: PerceptionProfile = {
  ...defaultProfile,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
};
try {
  const parsed = perceptionProfileSchema.safeParse(
    JSON.parse(localStorage.getItem('statework.preferences') ?? 'null'),
  );
  if (parsed.success) profile = parsed.data;
} catch {
  /* Preferences are optional. */
}
let client: WorkClient;
let state: WorkState;
let observation: Observation;
let spaces: Awaited<ReturnType<WorkClient['list']>> = [];
let workspaceId = localStorage.getItem('statework.workspace') ?? 'welcome';
let mode = 'list';
let filter = 'all';
let search = '';
let selected: string | null = null;
let busy = false;
let page = 0;
let searchTimer: ReturnType<typeof setTimeout>;
const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
let announcementTimer: ReturnType<typeof setTimeout>;
const announce = (message: string) => {
  clearTimeout(announcementTimer);
  $('#announcement').textContent = message;
  announcementTimer = setTimeout(() => {
    $('#announcement').textContent = '';
  }, 5000);
};
const error = (e: unknown) => {
  const message =
    e instanceof WorkError
      ? `${e.message}${Array.isArray(e.details) ? ' ' + e.details.map((v: { path: string; message: string }) => `${v.path}: ${v.message}`).join(' ') : ''}`
      : e instanceof Error
        ? e.message
        : 'Something went wrong.';
  $('#error').textContent = message;
  $('#error').hidden = false;
  const active = document.querySelector<HTMLDialogElement>('dialog[open]');
  if (active) {
    active.querySelector('.form-error')!.textContent = message;
  }
};
function preferences() {
  document.documentElement.dataset.contrast = profile.contrast;
  document.documentElement.dataset.motion = profile.motion;
  document.documentElement.dataset.detail = profile.detail;
  document.documentElement.style.setProperty('--text-scale', String(profile.textScale));
}
function shell() {
  root.innerHTML = `<div class="shell"><aside class="rail" aria-label="Workspace navigation">
    <a class="brand" href="#"><span class="brand-mark" aria-hidden="true">s<span>•</span></span>statework<span class="edition">LOCAL</span></a>
    <div class="workspace-control"><label for="workspace">YOUR SPACE</label><select id="workspace" aria-label="Workspace"></select><button class="new-space" data-action="new-space">＋ New workspace</button></div>
    <nav aria-label="Work filters"><p class="eyebrow">MAKE ROOM</p><button data-filter="all">${icon('list')} <span>All work</span><span id="all-count" class="count"></span></button><button data-filter="next">◉ <span>Next actions</span></button><button data-filter="inbox">↓ <span>Inbox</span></button><button data-filter="scheduled">↔ <span>Scheduled</span></button><button data-filter="archive">▧ <span>Archive</span></button></nav>
    <nav id="saved" aria-label="Saved views"></nav>
    <div class="rail-bottom"><a class="button" href="/spatial/">◇ Spatial / VR workspace</a><div class="local-note"><span class="online-dot" aria-hidden="true"></span><strong>Just here. Just yours.</strong><span>Stored on this computer.</span></div><button data-action="export">↓ Export workspace</button><button data-action="import">↑ Import a snapshot</button><button data-action="preferences">⚙ Reading & interaction</button></div>
  </aside><div class="workspace"><header class="topbar"><span class="breadcrumb">Your work <span aria-hidden="true">/</span> <span id="crumb"></span></span><div class="top-actions"><button data-action="refresh" class="quiet">↻ <span>Refresh</span></button><span class="local-badge">● Local</span></div></header>
  <main id="main" tabindex="-1"><div class="page-heading"><div><p class="eyebrow" id="context">A LITTLE CLARITY</p><h1 id="heading">All work</h1><p id="subtitle" class="muted">A place for the things on your mind.</p></div><button class="primary" data-action="add">＋ Add work</button></div>
  <div class="toolbar"><div class="view-switch" role="group" aria-label="Choose a view">${['list', 'board', 'timeline', 'map', 'focus', 'text'].map((v) => `<button data-mode="${v}" aria-pressed="${v === 'list'}"><span aria-hidden="true">${icon(v)}</span> ${v[0]!.toUpperCase() + v.slice(1)}</button>`).join('')}</div><div class="search"><label class="sr-only" for="search">Find work</label><span aria-hidden="true">⌕</span><input id="search" type="search" placeholder="Find anything…" autocomplete="off"><kbd aria-hidden="true">Ctrl K</kbd></div></div>
  <div class="filter-line"><span id="result-count"></span><div><label class="sr-only" for="sort">Sort work</label><select id="sort"><option value="priority">Priority first</option><option value="due">Due date</option><option value="updated">Recently changed</option><option value="title">Title</option></select><button data-action="save-view" class="quiet">＋ Save view</button></div></div>
  <p id="error" class="error" role="alert" hidden></p><div id="work-area"><section id="content" aria-label="Work items"></section><aside id="details" aria-label="Work item details" hidden></aside></div><div id="pagination"></div>
  <footer class="work-footer"><span id="revision"></span><span>One set of work. Your way through it.</span></footer></main></div></div>
  <div id="announcement" class="announcement" role="status" aria-live="polite"></div>
  <dialog id="edit-dialog" aria-labelledby="edit-title"><form id="new-form"><div class="dialog-heading"><h2 id="edit-title">Make room for something</h2><button type="button" data-close aria-label="Close">×</button></div><p class="form-error" role="alert"></p><label>Title<input name="title" required maxlength="240" placeholder="What’s on your mind?"></label><div class="form-grid"><label>Kind<select name="kind"><option value="task">Task</option><option value="project">Project</option><option value="note">Note</option><option value="event">Event</option></select></label><label>Priority<select name="priority"><option value="0">None</option><option value="1">Low</option><option value="2">Medium</option><option value="3">High</option></select></label><label>Due date<input type="date" name="dueDate"></label><label>Estimated minutes<input type="number" name="effortMinutes" min="0" max="525600"></label></div><label>Notes<textarea name="description" rows="3" maxlength="20000"></textarea></label><label>Tags <span class="muted">(comma separated)</span><input name="tags" maxlength="1000" placeholder="studio, personal"></label><div class="dialog-footer"><button type="button" data-close>Cancel</button><button class="primary" type="submit">Add to inbox</button></div></form></dialog>
  <dialog id="space-dialog" aria-labelledby="space-title"><form id="space-form"><div class="dialog-heading"><h2 id="space-title">A space of your own</h2><button type="button" data-close aria-label="Close">×</button></div><p class="form-error" role="alert"></p><label>Workspace name<input name="title" required maxlength="240" placeholder="My work"></label><div class="dialog-footer"><button class="primary">Create workspace</button></div></form></dialog>
  <dialog id="view-dialog" aria-labelledby="view-title"><form id="view-form"><div class="dialog-heading"><h2 id="view-title">Keep this way of looking</h2><button type="button" data-close aria-label="Close">×</button></div><p class="form-error" role="alert"></p><label>View name<input name="title" required maxlength="240" placeholder="My next steps"></label><p class="muted">Saves the current filters, search, sort order, and view.</p><div class="dialog-footer"><button class="primary">Save view</button></div></form></dialog>
  <dialog id="preferences-dialog" aria-labelledby="preferences-title"><form id="preferences-form"><div class="dialog-heading"><h2 id="preferences-title">Make yourself comfortable</h2><button type="button" data-close aria-label="Close">×</button></div><p class="form-error" role="alert"></p><p class="muted">These preferences stay in this browser. All work remains available in every view.</p><label>Text size<select name="textScale"><option value="1">100%</option><option value="1.25">125%</option><option value="1.5">150%</option><option value="2">200%</option></select></label><label>Reading detail<select name="detail"><option value="brief">Brief — less at once</option><option value="standard">Standard</option><option value="expanded">Expanded — show the context</option></select></label><label>Contrast<select name="contrast"><option value="standard">Standard</option><option value="high">High contrast</option></select></label><label>Motion<select name="motion"><option value="none">No motion</option><option value="reduced">Reduced</option><option value="full">Allow motion</option></select></label><label>Items per page<select name="maxItems"><option value="10">10</option><option value="25">25</option><option value="100">100</option></select></label><label>Display time zone<input name="timeZone" required></label><p class="keyboard-note">Use Tab and Shift + Tab to move, Enter to open, Escape to close a dialog. Ctrl/⌘ + K finds work. Focus view offers one actionable item at a time. Speech is available on demand in Text view.</p><div class="dialog-footer"><button class="primary">Apply preferences</button></div></form></dialog>
  <dialog id="import-dialog" aria-labelledby="import-title"><form id="import-form"><div class="dialog-heading"><h2 id="import-title">Bring a workspace with you</h2><button type="button" data-close aria-label="Close">×</button></div><p class="form-error" role="alert"></p><label>Snapshot file<input type="file" name="file" accept="application/json,.json" required></label><label>Name for the imported workspace<input name="title" required maxlength="240"></label><p class="muted">Creates a new workspace. Your existing work stays in place.</p><div class="dialog-footer"><button class="primary">Import workspace</button></div></form></dialog>`;
  root.addEventListener('click', onClick);
  root.addEventListener('submit', (event) => {
    event.preventDefault();
    void submit(event.target as HTMLFormElement).catch(error);
  });
  $('#search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    search = $<HTMLInputElement>('#search').value;
    page = 0;
    searchTimer = setTimeout(() => {
      void refreshObservation().catch(error);
    }, 180);
  });
  $('#sort').addEventListener('change', () => {
    page = 0;
    void refreshObservation().catch(error);
  });
  $('#workspace').addEventListener('change', () => {
    workspaceId = $<HTMLSelectElement>('#workspace').value;
    selected = null;
    filter = 'all';
    page = 0;
    search = '';
    $<HTMLInputElement>('#search').value = '';
    renderDetails();
    void load().catch(error);
  });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (!document.querySelector('dialog[open]')) $<HTMLInputElement>('#search').focus();
    }
  });
  window.addEventListener('hashchange', () => {
    const id = new URLSearchParams(location.hash.slice(1)).get('item');
    if (id && state?.items.some((i) => i.id === id)) {
      selected = id;
      renderDetails();
    }
  });
}
function currentQuery(): Query {
  const base: Query =
    filter === 'next'
      ? { actionable: true }
      : filter === 'inbox'
        ? { statuses: ['inbox'] }
        : filter === 'scheduled'
          ? { scheduled: true }
          : filter === 'archive'
            ? { archived: true }
            : filter.startsWith('saved:')
              ? { ...state.views.find((v) => v.id === filter.slice(6))?.query }
              : {};
  return {
    ...base,
    ...(search ? { text: search } : {}),
    sort: $<HTMLSelectElement>('#sort').value as Query['sort'],
  };
}
async function load() {
  spaces = await client.list();
  if (!spaces.length) {
    const created = await client.create({ id: uid(), title: 'My work' });
    workspaceId = created.workspace.id;
    spaces = await client.list();
  }
  if (!spaces.some((w) => w.id === workspaceId)) workspaceId = spaces[0]!.id;
  state = await client.snapshot(workspaceId);
  localStorage.setItem('statework.workspace', workspaceId);
  $<HTMLSelectElement>('#workspace').innerHTML = spaces
    .map(
      (w) =>
        `<option value="${esc(w.id)}" ${w.id === workspaceId ? 'selected' : ''}>${esc(w.title)}</option>`,
    )
    .join('');
  $('#crumb').textContent = state.workspace.title;
  $('#all-count').textContent = String(state.items.filter((i) => !i.archived).length);
  $('#saved').innerHTML = state.views.length
    ? `<p class="eyebrow">YOUR WAYS IN</p>${state.views.map((v) => `<button data-filter="saved:${esc(v.id)}">◇ <span>${esc(v.title)}</span></button>`).join('')}`
    : '';
  await refreshObservation();
  renderDetails();
}
let observationRequest = 0;
async function refreshObservation(attempt = 0) {
  const ticket = ++observationRequest;
  const obs = await client.observe(workspaceId, {
    query: currentQuery(),
    offset: page * profile.maxItems,
    limit: profile.maxItems,
  });
  if (ticket !== observationRequest) return;
  if (obs.workspace.revision !== state.workspace.revision) {
    if (attempt >= 3)
      throw new WorkError(
        'CONFLICT',
        'Work is changing quickly. Refresh to load the latest version.',
      );
    state = await client.snapshot(workspaceId);
    return refreshObservation(attempt + 1);
  }
  if (page > 0 && obs.total <= page * profile.maxItems) {
    page = Math.max(0, Math.ceil(obs.total / profile.maxItems) - 1);
    return refreshObservation(attempt);
  }
  observation = obs;
  const titles: Record<string, string> = {
    all: 'All work',
    next: 'Your next moves',
    inbox: 'Room for an idea',
    scheduled: 'Time, with context',
    archive: 'Safely set aside',
  };
  $('#heading').textContent = filter.startsWith('saved:')
    ? (state.views.find((v) => v.id === filter.slice(6))?.title ?? 'Saved view')
    : (titles[filter] ?? 'All work');
  $('#subtitle').textContent =
    filter === 'next'
      ? 'Clear prerequisites. A little momentum.'
      : filter === 'inbox'
        ? 'Capture first. Find its place later.'
        : filter === 'archive'
          ? 'Your history stays connected. Restore anything when you need it.'
          : 'A place for the things on your mind.';
  document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((b) => {
    b.setAttribute('aria-current', String(b.dataset.filter === filter));
  });
  document
    .querySelectorAll<HTMLButtonElement>('[data-mode]')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
  $('#result-count').textContent =
    `${observation.total} ${observation.total === 1 ? 'item' : 'items'}${search ? ` matching “${search}”` : ''}`;
  $('#revision').textContent = `Saved locally · revision ${state.workspace.revision}`;
  renderContent();
  $('#pagination').innerHTML =
    page > 0 || observation.nextOffset !== null
      ? `<button data-action="prev-page" ${page === 0 ? 'disabled' : ''}>← Previous</button><span>Page ${page + 1}</span><button data-action="next-page" ${observation.nextOffset === null ? 'disabled' : ''}>Next →</button>`
      : '';
}
const badge = (i: WorkItem) =>
  `<span class="status status-${i.status}">${i.status === 'inbox' ? 'Inbox' : i.status === 'ready' ? 'Ready' : i.status === 'active' ? 'In progress' : i.status === 'done' ? 'Done' : 'Cancelled'}</span>`;
const due = (i: WorkItem) =>
  i.dueDate
    ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
        new Date(`${i.dueDate}T12:00:00.000Z`),
      )
    : i.schedule
      ? new Intl.DateTimeFormat('en', {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZone: profile.timeZone,
        }).format(new Date(i.schedule.start))
      : 'No due date';
const itemFor = (id: string) => state.items.find((i) => i.id === id)!;
const nodeFor = (id: string) => observation.nodes.find((n) => n.id === id);
function taskCard(item: WorkItem, large = false): string {
  const node = nodeFor(item.id)!;
  const blocked = node.facts.some((f) => f.key === 'blocked' && f.value === true);
  return `<article class="task-card ${large ? 'large-card' : ''}"><div class="card-top">${badge(item)}<span class="kind">${esc(item.kind)}</span></div><button class="card-title" data-open="${esc(item.id)}">${esc(item.title)}</button>${profile.detail !== 'brief' && item.description ? `<p class="card-description">${esc(item.description)}</p>` : ''}<div class="card-meta">${item.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div><div class="card-bottom"><span>${item.effortMinutes !== null ? `${item.effortMinutes} min` : 'At your pace'}</span><span>${blocked ? '↳ Waiting' : item.dueDate ? esc(due(item)) : ''}</span></div></article>`;
}
function renderContent() {
  const content = $('#content');
  const items = observation.nodes.map((n) => itemFor(n.id)).filter(Boolean);
  content.className = `content-${mode}`;
  if (!items.length) {
    content.innerHTML = `<div class="empty"><span class="empty-symbol" aria-hidden="true">⌑</span><h2>${search ? 'Nothing by that name' : 'A little open space'}</h2><p>${search ? 'Try a different word or another view.' : 'Add a task, a project, a note. Give it a place to begin.'}</p><button data-action="add">＋ Add work</button></div>`;
    return;
  }
  if (mode === 'list')
    content.innerHTML = `<div class="list-heading" aria-hidden="true"><span>THE WORK</span><span>STATUS</span><span>WHEN</span><span></span></div><ul class="work-list">${items
      .map((i) => {
        const node = nodeFor(i.id)!;
        const complete = node.actions.find((a) => a.id === 'complete' || a.id === 'reopen')!;
        const waiting = node.facts.some((f) => f.key === 'blocked' && f.value === true);
        return `<li><div class="item-main"><button class="check ${i.status === 'done' ? 'checked' : ''}" data-toggle="${esc(i.id)}" ${complete.enabled ? '' : 'disabled'} aria-label="${esc(complete.label)}: ${esc(i.title)}" title="${esc(complete.reason ?? complete.label)}">${i.status === 'done' ? '✓' : ''}</button><div><button class="item-title" data-open="${esc(i.id)}">${esc(i.title)}</button><div class="item-sub"><span>${esc(i.kind)}</span>${i.tags
          .slice(0, profile.detail === 'brief' ? 0 : 2)
          .map((t) => `<span class="tag">${esc(t)}</span>`)
          .join(
            '',
          )}${waiting ? '<span class="waiting">↳ Waiting for a prerequisite</span>' : ''}${profile.detail === 'expanded' ? `<p>${esc(i.description)}</p>` : ''}</div></div></div><div>${badge(i)}</div><span class="date-label">${esc(due(i))}</span><button class="open-arrow" data-open="${esc(i.id)}" aria-label="Open ${esc(i.title)}">↗</button></li>`;
      })
      .join('')}</ul>`;
  else if (mode === 'board')
    content.innerHTML = `<div class="board">${(
      ['inbox', 'ready', 'active', 'done', 'cancelled'] as Status[]
    )
      .map((status) => {
        const column = items.filter((i) => i.status === status);
        return `<section class="board-column"><h2>${{ inbox: 'Inbox', ready: 'Ready', active: 'In progress', done: 'Done', cancelled: 'Cancelled' }[status]} <span>${column.length}</span></h2>${column.map((i) => taskCard(i)).join('') || '<p class="column-empty">Room to breathe.</p>'}</section>`;
      })
      .join(
        '',
      )}</div><p class="view-note">Open any card to change its status. No dragging required.</p>`;
  else if (mode === 'timeline') {
    const groups = new Map<string, WorkItem[]>();
    for (const item of items) {
      const date = item.schedule
        ? new Intl.DateTimeFormat('en-CA', {
            timeZone: profile.timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
          }).format(new Date(item.schedule.start))
        : (item.dueDate ?? 'Unscheduled');
      groups.set(date, [...(groups.get(date) ?? []), item]);
    }
    content.innerHTML = `<p class="view-note">Scheduled times in ${esc(profile.timeZone)}. Due dates remain calendar dates.</p><div class="timeline">${[
      ...groups,
    ]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([date, group]) =>
          `<section class="time-group"><div class="time-date"><span class="time-dot" aria-hidden="true"></span><h2>${date === 'Unscheduled' ? 'Anytime' : esc(date)}</h2></div><div>${group.map((i) => `<article class="timeline-item"><div><span class="kind">${i.schedule ? esc(new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', timeZone: profile.timeZone }).format(new Date(i.schedule.start))) : i.dueDate ? 'Due this day' : 'No time set'}</span><button data-open="${esc(i.id)}" class="item-title">${esc(i.title)}</button></div>${badge(i)}</article>`).join('')}</div></section>`,
      )
      .join('')}</div>`;
  } else if (mode === 'map') {
    const projection = spatialAdapter.render(observation, {
      ...profile,
      maxItems: Math.min(profile.maxItems, 30),
    });
    const count = projection.nodes.length;
    const points = new Map(
      projection.nodes.map((n, i) => [
        n.id,
        {
          x:
            count <= 10
              ? 400 + 270 * Math.cos((i * 2 * Math.PI) / count - Math.PI / 2)
              : 100 + (i % 5) * 150,
          y:
            count <= 10
              ? 250 + 175 * Math.sin((i * 2 * Math.PI) / count - Math.PI / 2)
              : 70 + Math.floor(i / 5) * 95,
        },
      ]),
    );
    const height = count <= 10 ? 500 : Math.ceil(count / 5) * 95 + 50;
    content.innerHTML = `<div class="map-header"><span><i class="legend-line"></i> Parent / reference</span><span><i class="legend-line dashed"></i> Prerequisite</span><span>${count} connected places</span></div><svg class="graph" viewBox="0 0 800 ${height}" role="group" aria-label="Work relationship map. The linked item list below provides the same navigation.">${projection.links
      .map((l) => {
        const a = points.get(l.from)!,
          b = points.get(l.to)!;
        return `<path d="M${a.x},${a.y} L${b.x},${b.y}" class="edge ${l.kind === 'depends_on' ? 'dependency' : ''}"><title>${esc(l.kind)}: ${esc(itemFor(l.from).title)} to ${esc(itemFor(l.to).title)}</title></path>`;
      })
      .join('')}${projection.nodes
      .map((n) => {
        const p = points.get(n.id)!;
        const label = n.label.length > 23 ? n.label.slice(0, 21) + '…' : n.label;
        return `<a tabindex="0" href="#item=${encodeURIComponent(n.id)}" aria-label="Open ${esc(n.label)}"><g transform="translate(${p.x - 75},${p.y - 26})"><rect width="150" height="56" rx="12" class="graph-node ${n.id === selected ? 'selected' : ''}"/><text x="12" y="21" class="graph-kind">${esc(itemFor(n.id).kind.toUpperCase())}</text><text x="12" y="40">${esc(label)}</text><title>${esc(n.summary)}</title></g></a>`;
      })
      .join(
        '',
      )}</svg><details class="map-text" open><summary>Read the connections</summary><ul>${projection.nodes
      .map(
        (n) =>
          `<li><button data-open="${esc(n.id)}">${esc(n.label)}</button><span>${esc(
            nodeFor(n.id)!
              .relationships.map(
                (r) =>
                  `${r.kind === 'depends_on' ? (r.direction === 'outgoing' ? 'needs' : 'needed by') : r.kind === 'contains' ? (r.direction === 'outgoing' ? 'contains' : 'part of') : 'related to'} ${r.targetLabel}`,
              )
              .join(' · ') || 'No connections yet',
          )}</span></li>`,
      )
      .join(
        '',
      )}</ul></details>${observation.total > 30 ? '<p class="view-note">Map shows up to 30 items per page. Use search or a saved view to narrow the map.</p>' : ''}`;
  } else if (mode === 'focus') {
    const actionable = items.filter(
      (i) =>
        i.kind === 'task' &&
        !['done', 'cancelled'].includes(i.status) &&
        !nodeFor(i.id)!.facts.some((f) => f.key === 'blocked' && f.value === true),
    );
    const item = actionable[0];
    content.innerHTML = item
      ? `<div class="focus-view"><p class="eyebrow">JUST ONE THING</p>${taskCard(item, true)}<div class="focus-actions"><button class="primary" data-toggle="${esc(item.id)}">✓ Mark complete</button><button data-open="${esc(item.id)}">Open the context ↗</button></div><p class="muted">${actionable.length - 1} more actionable ${actionable.length === 2 ? 'item' : 'items'} on this page. They can wait.</p></div>`
      : '<div class="empty"><h2>No clear next step on this page</h2><p>Choose Next actions to find unblocked work, or open the list to resolve prerequisites.</p><button data-filter="next">Show next actions</button></div>';
  } else
    content.innerHTML = `<div class="text-view"><div class="text-actions"><button data-action="copy-text">Copy as text</button>${'speechSynthesis' in window ? '<button data-action="speak">Read aloud</button><button data-action="stop-speech">Stop reading</button>' : ''}</div><pre>${esc(textAdapter.render(observation, profile))}</pre><ol class="text-links">${items.map((i) => `<li><button data-open="${esc(i.id)}">Open ${esc(i.title)}</button></li>`).join('')}</ol><p class="view-note">Speech uses your browser’s local voices when available. Your work is never sent to a speech service by StateWork.</p></div>`;
}
function renderDetails() {
  const pane = $('#details');
  const item = state.items.find((i) => i.id === selected);
  if (!item) {
    pane.hidden = true;
    $('#work-area').classList.remove('with-details');
    return;
  }
  pane.hidden = false;
  $('#work-area').classList.add('with-details');
  const relationships = state.relations.filter((r) => r.from === item.id || r.to === item.id);
  const writable = spaces.find((w) => w.id === workspaceId)?.role !== 'reader';
  pane.innerHTML = `<div class="detail-heading"><span class="eyebrow">${esc(item.kind)} · DETAILS</span><button data-action="close-details" aria-label="Close details">×</button></div><h2 id="detail-title" tabindex="-1">${esc(item.title)}</h2><form id="detail-form" data-item="${esc(item.id)}" data-version="${item.version}" data-revision="${state.workspace.revision}"><p class="form-error" role="alert"></p><fieldset ${writable ? '' : 'disabled'}><label>Title<input name="title" value="${esc(item.title)}" required maxlength="240"></label><label>Notes<textarea name="description" rows="4" maxlength="20000">${esc(item.description)}</textarea></label><div class="form-grid"><label>Status<select name="status">${(['inbox', 'ready', 'active', 'done', 'cancelled'] as Status[]).map((s) => `<option value="${s}" ${s === item.status ? 'selected' : ''}>${{ inbox: 'Inbox', ready: 'Ready', active: 'In progress', done: 'Done', cancelled: 'Cancelled' }[s]}</option>`).join('')}</select></label><label>Priority<select name="priority">${['None', 'Low', 'Medium', 'High'].map((p, i) => `<option value="${i}" ${i === item.priority ? 'selected' : ''}>${p}</option>`).join('')}</select></label></div><label>Due date<input type="date" name="dueDate" value="${esc(item.dueDate ?? '')}"></label><label>Tags<input name="tags" value="${esc(item.tags.join(', '))}" maxlength="1000"></label><details class="time-settings"><summary>Time and effort</summary><label>Estimated minutes<input type="number" name="effortMinutes" value="${item.effortMinutes ?? ''}" min="0" max="525600"></label><label>Scheduled start (UTC)<input type="datetime-local" step="0.001" name="start" value="${esc(item.schedule?.start.slice(0, -1) ?? '')}"></label><label>Scheduled end (UTC)<input type="datetime-local" step="0.001" name="end" value="${esc(item.schedule?.end.slice(0, -1) ?? '')}"></label><label>Schedule time zone<input name="timeZone" value="${esc(item.schedule?.timeZone ?? profile.timeZone)}"></label><p class="muted">Enter both UTC times, or clear both to remove the schedule. Timeline uses your display time zone.</p></details><button class="primary save-detail" type="submit">Save changes</button></fieldset></form><section class="connections"><h3>Connected work <span>${relationships.length}</span></h3>${
    relationships.length
      ? `<ul>${relationships
          .map((r) => {
            const outgoing = r.from === item.id;
            const target = itemFor(outgoing ? r.to : r.from);
            return `<li><div><span class="kind">${r.kind === 'depends_on' ? (outgoing ? 'Needs' : 'Needed by') : r.kind === 'contains' ? (outgoing ? 'Contains' : 'Part of') : 'Related to'}</span><button data-open="${esc(target.id)}">${esc(target.title)}</button></div>${writable ? `<button class="remove-link" data-remove="${esc(r.id)}" aria-label="Remove connection to ${esc(target.title)}">×</button>` : ''}</li>`;
          })
          .join('')}</ul>`
      : '<p class="muted">Give this work some context.</p>'
  }${
    writable
      ? `<form id="relation-form"><label class="sr-only" for="relation-kind">Relationship type</label><select id="relation-kind" name="kind"><option value="depends_on">Needs…</option><option value="contains">Contains…</option><option value="relates_to">Related to…</option></select><label class="sr-only" for="relation-target">Connected item</label><select id="relation-target" name="target" required><option value="">Choose work</option>${state.items
          .filter((i) => i.id !== item.id)
          .map((i) => `<option value="${esc(i.id)}">${esc(i.title)}</option>`)
          .join('')}</select><button type="submit">＋ Link</button></form>`
      : ''
  }</section><div class="detail-bottom"><button data-archive="${esc(item.id)}" ${writable ? '' : 'disabled'}>${item.archived ? 'Restore from archive' : 'Move to archive'}</button><span>Version ${item.version}</span></div>`;
}
function openDialog(id: string) {
  const dialog = $<HTMLDialogElement>(`#${id}-dialog`);
  dialog.querySelector<HTMLFormElement>('form')!.reset();
  dialog.querySelector('.form-error')!.textContent = '';
  dialog.showModal();
}
function closeDialogs() {
  document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach((d) => d.close());
}
async function mutate(commands: Command[], revision = state.workspace.revision) {
  if (busy) throw new WorkError('CONFLICT', 'A save is still in progress. Please wait.');
  busy = true;
  $('#error').hidden = true;
  const active = document.activeElement as HTMLInputElement | null;
  const formId = active?.closest('form')?.id;
  const name = active?.name;
  try {
    await client.execute(workspaceId, {
      schemaVersion: 1,
      requestId: uid(),
      expectedRevision: revision,
      commands,
    });
    await load();
    if (formId && name)
      document
        .querySelector<HTMLElement>(`#${CSS.escape(formId)} [name="${CSS.escape(name)}"]`)
        ?.focus();
    announce('Saved on this computer.');
  } finally {
    busy = false;
  }
}
async function onClick(event: MouseEvent) {
  const button = (event.target as Element).closest<HTMLElement>('button');
  if (!button) return;
  try {
    if (button.hasAttribute('data-close')) {
      button.closest<HTMLDialogElement>('dialog')?.close();
      return;
    }
    if (button.dataset.open) {
      selected = button.dataset.open;
      renderDetails();
      $('#detail-title').focus();
      return;
    }
    if (button.dataset.mode) {
      mode = button.dataset.mode;
      await refreshObservation();
      announce(`${mode} view`);
      return;
    }
    if (button.dataset.filter) {
      filter = button.dataset.filter;
      page = 0;
      search = '';
      $<HTMLInputElement>('#search').value = '';
      if (filter.startsWith('saved:')) {
        const view = state.views.find((v) => v.id === filter.slice(6));
        if (view) {
          mode = ['list', 'board', 'timeline', 'map', 'focus', 'text'].includes(view.renderer)
            ? view.renderer
            : 'text';
          search = view.query.text ?? '';
          $<HTMLInputElement>('#search').value = search;
          $<HTMLSelectElement>('#sort').value = view.query.sort ?? 'priority';
        }
      }
      await refreshObservation();
      return;
    }
    if (button.dataset.toggle) {
      const item = itemFor(button.dataset.toggle);
      await mutate([
        {
          type: 'item.update',
          id: item.id,
          expectedVersion: item.version,
          patch: {
            status: item.status === 'done' || item.status === 'cancelled' ? 'ready' : 'done',
          },
        },
      ]);
      return;
    }
    if (button.dataset.archive) {
      const item = itemFor(button.dataset.archive);
      await mutate([
        {
          type: 'item.archive',
          id: item.id,
          expectedVersion: item.version,
          archived: !item.archived,
        },
      ]);
      return;
    }
    if (button.dataset.remove) {
      await mutate([{ type: 'relation.remove', id: button.dataset.remove }]);
      return;
    }
    switch (button.dataset.action) {
      case 'add':
        openDialog('edit');
        break;
      case 'new-space':
        openDialog('space');
        break;
      case 'save-view':
        openDialog('view');
        break;
      case 'import':
        openDialog('import');
        break;
      case 'preferences': {
        openDialog('preferences');
        const form = $<HTMLFormElement>('#preferences-form');
        for (const key of [
          'detail',
          'contrast',
          'motion',
          'maxItems',
          'timeZone',
          'textScale',
        ] as const)
          (form.elements.namedItem(key) as HTMLInputElement).value = String(profile[key]);
        break;
      }
      case 'refresh':
        await load();
        announce('Latest local changes loaded.');
        break;
      case 'close-details': {
        const old = selected;
        selected = null;
        renderDetails();
        document
          .querySelector<HTMLButtonElement>(`[data-open="${CSS.escape(old ?? '')}"]`)
          ?.focus();
        break;
      }
      case 'prev-page':
        page = Math.max(0, page - 1);
        await refreshObservation();
        $('#main').focus();
        break;
      case 'next-page':
        page++;
        await refreshObservation();
        $('#main').focus();
        break;
      case 'export': {
        const snapshot = await client.export(workspaceId);
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }),
        );
        const a = document.createElement('a');
        a.href = url;
        a.download = `statework-${workspaceId}.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        announce('Workspace snapshot exported.');
        break;
      }
      case 'copy-text':
        await navigator.clipboard.writeText(textAdapter.render(observation, profile));
        announce('Text copied.');
        break;
      case 'speak': {
        speechSynthesis.cancel();
        const voice = speechSynthesis
          .getVoices()
          .find((v) => v.localService && v.lang.startsWith(profile.language));
        if (!voice) {
          announce('No local speech voice is available. Use your screen reader or copy the text.');
          break;
        }
        const utterance = new SpeechSynthesisUtterance(textAdapter.render(observation, profile));
        utterance.voice = voice;
        speechSynthesis.speak(utterance);
        break;
      }
      case 'stop-speech':
        speechSynthesis.cancel();
        break;
    }
  } catch (e) {
    error(e);
  }
}
async function submit(form: HTMLFormElement) {
  const data = new FormData(form);
  const value = (key: string) => String(data.get(key) ?? '');
  const tags = () => [
    ...new Set(
      value('tags')
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ];
  if (form.id === 'new-form') {
    await mutate([
      {
        type: 'item.create',
        item: {
          id: uid(),
          kind: value('kind') as WorkItem['kind'],
          title: value('title'),
          description: value('description'),
          priority: Number(value('priority')) as WorkItem['priority'],
          dueDate: value('dueDate') || null,
          effortMinutes: value('effortMinutes') ? Number(value('effortMinutes')) : null,
          tags: tags(),
        },
      },
    ]);
    closeDialogs();
  } else if (form.id === 'detail-form') {
    const start = value('start'),
      end = value('end');
    if (Boolean(start) !== Boolean(end))
      throw new WorkError('VALIDATION', 'Enter both start and end, or clear both.');
    await mutate(
      [
        {
          type: 'item.update',
          id: form.dataset.item!,
          expectedVersion: Number(form.dataset.version),
          patch: {
            title: value('title'),
            description: value('description'),
            status: value('status') as Status,
            priority: Number(value('priority')) as WorkItem['priority'],
            dueDate: value('dueDate') || null,
            effortMinutes: value('effortMinutes') ? Number(value('effortMinutes')) : null,
            tags: tags(),
            schedule: start
              ? {
                  start: new Date(start + 'Z').toISOString(),
                  end: new Date(end + 'Z').toISOString(),
                  timeZone: value('timeZone'),
                }
              : null,
          },
        },
      ],
      Number(form.dataset.revision),
    );
  } else if (form.id === 'relation-form') {
    await mutate([
      {
        type: 'relation.add',
        relation: {
          id: uid(),
          kind: value('kind') as 'depends_on' | 'contains' | 'relates_to',
          from: selected!,
          to: value('target'),
        },
      },
    ]);
  } else if (form.id === 'space-form') {
    const created = await client.create({ id: uid(), title: value('title') });
    workspaceId = created.workspace.id;
    selected = null;
    filter = 'all';
    page = 0;
    search = '';
    $<HTMLInputElement>('#search').value = '';
    await load();
    closeDialogs();
    announce('Your new workspace is ready.');
  } else if (form.id === 'view-form') {
    await mutate([
      {
        type: 'view.save',
        view: { id: uid(), title: value('title'), query: currentQuery(), renderer: mode },
      },
    ]);
    closeDialogs();
  } else if (form.id === 'preferences-form') {
    new Intl.DateTimeFormat('en', { timeZone: value('timeZone') });
    profile = perceptionProfileSchema.parse({
      ...profile,
      detail: value('detail'),
      motion: value('motion'),
      contrast: value('contrast'),
      maxItems: Number(value('maxItems')),
      textScale: Number(value('textScale')),
      timeZone: value('timeZone'),
    });
    localStorage.setItem('statework.preferences', JSON.stringify(profile));
    preferences();
    page = 0;
    await refreshObservation();
    closeDialogs();
    announce('Preferences applied.');
  } else if (form.id === 'import-form') {
    const file = data.get('file') as File;
    if (file.size > 1_000_000)
      throw new WorkError(
        'LIMIT',
        'Browser imports support snapshots up to 1 MB. Use the CLI for larger workspaces.',
      );
    const imported = await client.import(JSON.parse(await file.text()), {
      id: uid(),
      title: value('title'),
    });
    workspaceId = imported.workspace.id;
    selected = null;
    filter = 'all';
    page = 0;
    search = '';
    $<HTMLInputElement>('#search').value = '';
    await load();
    closeDialogs();
    announce('Snapshot imported into a new workspace.');
  }
}
async function boot() {
  preferences();
  const response = await fetch('/local/session', {
    method: 'POST',
    headers: { 'X-StateWork-Local': '1' },
  });
  if (!response.ok)
    throw new Error(
      'Open StateWork from http://127.0.0.1:4180 on this computer. The local session is unavailable.',
    );
  const { token } = await response.json();
  client = new WorkClient(location.origin, token);
  shell();
  await load();
  const id = new URLSearchParams(location.hash.slice(1)).get('item');
  if (id && state.items.some((i) => i.id === id)) {
    selected = id;
    renderDetails();
  }
}
void boot().catch((e) => {
  root.innerHTML = `<div class="boot-error"><span class="brand">statework</span><h1>Let’s reconnect</h1><p>${esc(e instanceof Error ? e.message : e)}</p><p>Start the local service with <code>npm start</code>, then reload this page.</p><button id="retry">Try again</button></div>`;
  $('#retry').addEventListener('click', () => location.reload());
});
