import { WorkClient, instructionUrl } from '@statework/sdk';
import type { WorkBrief, BriefOptions } from '@statework/sdk';
import './style.css';
const app = document.querySelector<HTMLDivElement>('#app')!;
const esc = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const params = new URLSearchParams(location.search);
let workspace = params.get('workspace') ?? '',
  taskId = params.get('task') ?? '';
let client: WorkClient, brief: WorkBrief;
let options: BriefOptions = { taskId: taskId || undefined, limit: 8 };
const safeLink = (url: string) =>
  url.startsWith('/brief/?') || url.startsWith('/instructions/?') || instructionUrl(url);
const marks: Record<string, string> = {
  ready: '▶',
  active: '▶',
  done: '✓',
  checked: '✓',
  blocked: '◆',
  missing: '◆',
  open: '?',
  historical: '◷',
  'needs-check': '◆',
  verified: '✓',
  recorded: '●',
};
const sections = ['overview', 'steps', 'sources', 'facts', 'questions', 'calendar'] as const;
const fail = (e: unknown) => {
  const el = document.querySelector<HTMLElement>('#error');
  if (el) {
    el.hidden = false;
    el.textContent = e instanceof Error ? e.message : String(e);
  } else app.textContent = String(e);
};
async function load(reset = false) {
  try {
    if (reset) {
      options.offset = 0;
      delete options.expectedRevision;
    }
    brief = await client.brief(workspace, options);
    render();
  } catch (e) {
    fail(e);
  }
}
function render() {
  const counts = brief.counts;
  app.innerHTML = `<header><a href="/spatial/">← Office</a><a href="/brief/?workspace=${encodeURIComponent(workspace)}">All work</a><button id="refresh">Refresh</button></header>
    <main><p class="eyebrow">${esc(brief.workspace.title)}</p><h1>${esc(brief.task?.title ?? 'Find your work')}</h1>
    <p id="error" role="alert" hidden></p>
    ${
      brief.task
        ? `<section class="route" aria-label="Work direction"><article class="next"><span>▶ NEXT</span><h2>${esc(brief.next?.label ?? (brief.task.status === 'done' ? 'Work recorded done' : 'Review requirements'))}</h2><a class="button primary" href="${esc(brief.next?.url ?? brief.task.url)}">${brief.next ? 'Open action' : 'Open instructions'} →</a></article><article><span>◆ NEEDS ATTENTION</span><strong>${counts.blockers}</strong><button data-section="overview">View blockers</button></article><article><span>◷ EVIDENCE</span><strong>${counts.needsCheck ? 'Check sources' : counts.historical ? 'Historical' : 'View sources'}</strong><button data-section="sources">${counts.sources} sources →</button></article></section>
      <nav aria-label="Work details">${sections.map((s) => `<button data-section="${s}" aria-pressed="${brief.section === s}">${s === 'facts' ? 'Progress & decisions' : s[0]!.toUpperCase() + s.slice(1)}</button>`).join('')}</nav>`
        : `<form id="search"><label>Course, project or source URL<input name="query" value="${esc(options.text ?? '')}" type="search"/></label><button class="primary">Find work</button></form>`
    }
    <section class="cards" aria-label="${esc(brief.section)}">${brief.entries.map((e) => `<article class="card"><span class="state">${esc(marks[e.state] ?? '○')} ${esc(e.state)} · ${esc(e.kind)}</span><h2>${esc(e.label)}</h2>${e.detail ? `<p>${esc(e.detail)}</p>` : ''}${e.at ? `<time datetime="${esc(e.at)}">${esc(new Date(e.at).toLocaleString())}</time>` : ''}<div class="links">${e.url && safeLink(e.url) ? `<a class="button" href="${esc(e.url)}">Open →</a>` : ''}${e.kind === 'source' ? `<button data-source="${esc(e.id)}">Read evidence</button>` : e.sourceIds.length ? `<button data-record="${esc(e.id)}" data-kind="${e.kind === 'calendar' ? 'calendars' : 'facts'}">Full record</button>` : ''}</div></article>`).join('') || '<p>No records in this section.</p>'}</section>
    <footer><button id="previous" ${brief.offset === 0 ? 'disabled' : ''}>← Previous</button><span>${brief.total ? brief.offset + 1 : 0}–${Math.min(brief.offset + brief.entries.length, brief.total)} / ${brief.total}</span><button id="more" ${brief.nextOffset === null ? 'disabled' : ''}>Next →</button></footer>
    ${brief.task && brief.section === 'sources' ? `<label class="shared"><input id="shared" type="checkbox" ${options.includeInherited ? 'checked' : ''}/> Include shared project sources</label>` : ''}
    <p class="muted">${esc(brief.notice)}</p><section id="evidence" aria-live="polite"></section></main>`;
  document.querySelector('#refresh')!.addEventListener('click', () => void load(true));
  document.querySelectorAll<HTMLButtonElement>('[data-section]').forEach((b) =>
    b.addEventListener('click', () => {
      options.section = b.dataset.section as BriefOptions['section'];
      void load(true);
    }),
  );
  document.querySelector('#previous')!.addEventListener('click', () => {
    options.offset = Math.max(0, brief.offset - 8);
    options.expectedRevision = brief.workspace.revision;
    void load();
  });
  document.querySelector('#more')!.addEventListener('click', () => {
    if (brief.nextOffset !== null) {
      options.offset = brief.nextOffset;
      options.expectedRevision = brief.workspace.revision;
      void load();
    }
  });
  document.querySelector('#search')?.addEventListener('submit', (e) => {
    e.preventDefault();
    options.text = String(new FormData(e.currentTarget as HTMLFormElement).get('query') ?? '');
    void load(true);
  });
  document.querySelector<HTMLInputElement>('#shared')?.addEventListener('change', (e) => {
    options.includeInherited = (e.target as HTMLInputElement).checked;
    void load(true);
  });
  bindEvidence();
}
function bindEvidence() {
  document
    .querySelectorAll<HTMLButtonElement>('[data-source]')
    .forEach((b) => (b.onclick = () => void readSource(b.dataset.source!)));
  document
    .querySelectorAll<HTMLButtonElement>('[data-record]')
    .forEach(
      (b) =>
        (b.onclick = () =>
          void readRecord(b.dataset.kind as 'facts' | 'calendars', b.dataset.record!)),
    );
}
async function readSource(id: string, offset = 0) {
  try {
    const r = await client.sourceRead(workspace, id, {
      offset,
      limit: 4000,
      expectedRevision: brief.workspace.revision,
    });
    document.querySelector('#evidence')!.innerHTML =
      `<h2>${esc(r.source.title)}</h2><p>${esc(r.freshness.status)} · ${esc(r.source.locator)}</p><pre>${esc(r.content)}</pre><p>${r.offset}–${r.offset + r.content.length} / ${r.total} characters</p>${r.nextOffset !== null ? '<button id="source-more">Next excerpt →</button>' : ''}`;
    document
      .querySelector('#source-more')
      ?.addEventListener('click', () => void readSource(id, r.nextOffset!));
    document.querySelector('#evidence')!.scrollIntoView({ block: 'start' });
  } catch (e) {
    fail(e);
  }
}
async function readRecord(kind: 'facts' | 'calendars', id: string) {
  try {
    const r = await client.record(workspace, kind, id);
    const record = r.record;
    const details =
      'value' in record
        ? `<h2>${esc(record.kind)} · ${esc(record.key)}</h2><p>${esc(record.value)}</p><p>Occurred: ${esc(new Date(record.occurredAt).toLocaleString())}</p>`
        : 'baseline' in record
          ? `<h2>${esc(record.baseline.title)}</h2><p>${esc(record.provider)} · verified ${esc(new Date(record.observedAt).toLocaleString())}</p><p>${record.stopWhen ? `Stop when ${esc(record.stopWhen.key)} is ${esc(record.stopWhen.value)}` : 'No stop condition recorded.'}</p><p>Updates need a fresh calendar check.</p>`
          : '';
    document.querySelector('#evidence')!.innerHTML =
      `${details}<p>Recorded ${esc(new Date(record.recordedAt).toLocaleString())}</p>${'sourceIds' in record ? record.sourceIds.map((s, n) => `<button data-source="${esc(s)}">Evidence ${n + 1}</button>`).join('') : ''}`;
    bindEvidence();
  } catch (e) {
    fail(e);
  }
}
async function start() {
  const response = await fetch('/local/session', {
    method: 'POST',
    headers: { 'X-StateWork-Local': '1' },
  });
  if (!response.ok) throw new Error('Open StateWork on its local address.');
  client = new WorkClient('', (await response.json()).token);
  const spaces = await client.list();
  workspace ||= localStorage.getItem('statework.workspace') ?? spaces[0]?.id ?? '';
  if (!spaces.some((s) => s.id === workspace)) workspace = spaces[0]?.id ?? '';
  if (!workspace) throw new Error('Create a workspace in the office first.');
  await load();
}
void start().catch((e) => {
  app.innerHTML = `<main><a href="/">Open StateWork</a><h1>Could not open overview</h1><p role="alert">${esc(e instanceof Error ? e.message : e)}</p></main>`;
});
