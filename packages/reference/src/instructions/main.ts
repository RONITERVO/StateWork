import {
  WorkClient,
  WorkError,
  blankPacket,
  packetContext,
  packetIssues,
  latestPacket,
  packetCompleteCommand,
  packetInputSchema,
  sourceInputSchema,
  parse,
  instructionUrl,
} from '@statework/sdk';
import type {
  WorkState,
  PacketInput,
  WorkPacket,
  Command,
  SourceInput,
  WorkSource,
  Citation,
} from '@statework/sdk';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
const esc = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const uid = () => crypto.randomUUID();
const params = new URLSearchParams(location.search);
let workspace = params.get('workspace') ?? '',
  taskId = params.get('task') ?? '';
let client: WorkClient, state: WorkState, draft: PacketInput;
let reader = true,
  busy = false,
  dirty = false,
  index = 0;
let packet: WorkPacket | null = null;
let section = 'follow',
  notice = '',
  error = '',
  job = '',
  citeSource = '';
let proposal: PacketInput | null = null;
let previousDraft: { draft: PacketInput; pendingSources: SourceInput[] } | null = null;
let assistant = { available: false, name: 'Codex', message: 'Checking local assistance…' };
let capture = {
  title: '',
  locator: '',
  content: '',
  kind: 'note' as SourceInput['kind'],
  coverage: 'excerpt' as SourceInput['coverage'],
  replaces: null as string | null,
};
let warnings: string[] = [],
  pendingSources: SourceInput[] = [];
let polling: ReturnType<typeof setTimeout> | undefined;
const storageKey = () => `statework.packet.draft.${workspace}.${taskId}`;
const remember = () => {
  dirty = true;
  try {
    sessionStorage.setItem(storageKey(), JSON.stringify({ draft, pendingSources, previousDraft }));
  } catch {
    /* Explicit save is available. */
  }
};
const clearDraft = () => {
  dirty = false;
  try {
    sessionStorage.removeItem(storageKey());
  } catch {
    /* Optional recovery. */
  }
};
const current = () => draft.steps[index];
const source = (id: string) => state.instructions?.sources.find((s) => s.id === id);
const link = (url: string, label = 'Open ↗') =>
  instructionUrl(url)
    ? `<a class="button" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`
    : '';
const input = (name: string, label: string, value: string, type = 'text', max = 12000) =>
  `<label>${esc(label)}<input name="${esc(name)}" type="${type}" maxlength="${max}" value="${esc(value)}"></label>`;
const area = (name: string, label: string, value: string, rows = 3, max = 12000) =>
  `<label>${esc(label)}<textarea name="${esc(name)}" rows="${rows}" maxlength="${max}">${esc(value)}</textarea></label>`;
function setError(e: unknown) {
  error = e instanceof Error ? e.message : String(e);
  if (e instanceof WorkError && Array.isArray(e.details))
    error +=
      '\n' +
      e.details
        .map(
          (d: { message?: string; label?: string; path?: string }) =>
            `${d.path ?? ''} ${d.message ?? d.label ?? ''}`,
        )
        .join('\n');
}
async function execute(commands: Command[]) {
  await client.execute(workspace, {
    schemaVersion: 1,
    requestId: uid(),
    expectedRevision: state.workspace.revision,
    commands,
  });
  state = await client.snapshot(workspace);
  packet = latestPacket(state, taskId) ?? null;
}
function citations(cites: Citation[]): string {
  return cites
    .map((c) => {
      const s = source(c.sourceId);
      return `<blockquote class="source-citation">${esc(c.quote)}<footer>— ${esc(s?.title ?? 'Missing source')} · ${esc(c.location)} ${s && instructionUrl(s.locator) ? `<a href="${esc(s.locator)}" target="_blank" rel="noopener noreferrer">Original ↗</a>` : ''}</footer></blockquote>`;
    })
    .join('');
}
function follow() {
  const step = current();
  if (!step) return '<h2>No steps yet.</h2><button data-action="edit">＋ Add instructions</button>';
  const checked = packet?.checks.some((c) => c.stepId === step.id) ?? false;
  const writable = !reader && !dirty && !!packet && !packetIssues(state, packet).length;
  return `<div class="packet-focus-label"><p class="eyebrow">STEP ${index + 1} OF ${draft.steps.length}${step.minutes !== null ? ` · ${step.minutes} MIN` : ''}</p><span>${checked ? '✓ CHECKED' : '○ TO DO'}</span></div><h2>${esc(step.title)}</h2>${step.requires.length ? `<p>◇ ${esc(step.requires.map((id) => draft.requirements.find((r) => r.id === id)?.label ?? id).join(' · '))}</p>` : ''}<p>${esc(step.instruction || 'Exact instructions are missing. Open Edit to fill this gap.')}</p>${link(step.actionUrl, 'Open what I need ↗')}<div class="packet-check"><h3>✓ Check the result</h3><p>${esc(step.expected || 'The expected result has not been defined.')}</p><label>Evidence <small>— optional record</small><input id="check-evidence" maxlength="12000" placeholder="File, measurement, result…" ${reader ? 'disabled' : ''}></label><button class="primary" data-action="check" ${writable || (checked && !reader) ? '' : 'disabled'}>${checked ? '↶ Undo this result' : '✓ Result matches'}</button></div><div class="packet-recovery"><h3>◇ If stuck</h3><p>${esc(step.ifBlocked || 'Recovery instructions are missing.')}</p><button data-action="question-for-step" ${reader ? 'disabled' : ''}>Ask / record a gap</button></div><details><summary>Sources beside this step · ${step.citations.length}</summary>${citations(step.citations) || '<p>No evidence has been linked yet.</p>'}</details><div class="packet-stepnav"><button data-action="previous" ${index === 0 ? 'disabled' : ''}>← Previous</button><button data-action="next" ${index >= draft.steps.length - 1 ? 'disabled' : ''}>Next →</button></div>`;
}
function edit() {
  const s = current();
  return `<h2>Build the route.</h2><form id="packet-form" class="packet-form"><fieldset><legend>The finish line</legend>${input('title', 'Packet title', draft.title, 'text', 240)}${area('outcome', 'What will exist when this task is finished?', draft.outcome)}${area('finish', 'How to verify and deliver the whole result', draft.finish)}</fieldset>${
    s
      ? `<fieldset><legend>Step ${index + 1}</legend>${input('step-title', 'Short action label', s.title, 'text', 240)}${area('instruction', 'Exact action — tools, inputs, settings, location and order', s.instruction, 7)}${area('expected', 'The result must look like this', s.expected)}${area('ifBlocked', 'If it differs, do this / contact this person', s.ifBlocked)}<div class="packet-fields">${input('minutes', 'Minutes (optional)', s.minutes === null ? '' : String(s.minutes), 'number')}${input('actionUrl', 'Direct action link', s.actionUrl, 'url', 2048)}</div>${draft.requirements.length ? `<fieldset><legend>Needs first</legend>${draft.requirements.map((r) => `<label><input type="checkbox" name="requires" value="${esc(r.id)}" ${s.requires.includes(r.id) ? 'checked' : ''}>${esc(r.label)}</label>`).join('')}</fieldset>` : ''}<h3>Evidence</h3>${s.citations.map((c, i) => `${citations([c])}<button type="button" data-action="remove-citation:${i}">Remove citation ${i + 1}</button>`).join('') || '<p>Link a captured passage, or mark original instructions when saving.</p>'}<label>Captured source<select id="cite-source"><option value="">Choose a source</option>${(
          state.instructions?.sources ?? []
        )
          .filter((s) => draft.sourceIds.includes(s.id))
          .map(
            (s) =>
              `<option value="${esc(s.id)}" ${s.id === citeSource ? 'selected' : ''}>${esc(s.title)}</option>`,
          )
          .join(
            '',
          )}</select></label>${citeSource ? `<pre class="source-evidence" id="cite-content">${esc(source(citeSource)?.content)}</pre><p>Select the exact passage above.</p>${input('cite-location', 'Page / section / line', '')}<button type="button" data-action="cite-selection">Cite selection</button>` : ''}<div class="packet-toolbar"><button type="button" data-action="move-up" ${index === 0 ? 'disabled' : ''}>↑ Move up</button><button type="button" data-action="move-down" ${index === draft.steps.length - 1 ? 'disabled' : ''}>↓ Move down</button><button type="button" data-action="remove-step">Remove step</button></div></fieldset>`
      : '<p>Add the first action below.</p>'
  }<button type="button" data-action="add-step">＋ Add action</button><fieldset><legend>Author evidence</legend><label><input type="checkbox" id="own-instructions">These uncited steps are my original instructions. Capture my writing as their source.</label><small>This records you as the author. It does not verify an outside requirement.</small></fieldset></form><div class="packet-toolbar"><button class="primary" data-action="save">Save draft</button><button data-action="follow">Follow view</button></div>`;
}
function needs() {
  return `<h2>Have everything ready.</h2><form id="needs-form" class="packet-form">${
    draft.requirements
      .map(
        (r, i) =>
          `<fieldset data-need="${i}"><legend>◇ ${esc(r.label)}</legend>${input('label', 'Requirement', r.label, 'text', 240)}<label>Type<select name="kind">${['task', 'account', 'software', 'person', 'material', 'information'].map((k) => `<option ${r.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>${area('detail', 'Exactly what is needed and where to get it', r.detail)}${area('check', 'How to confirm it is ready', r.check)}${input('url', 'Get it / contact link', r.url, 'url', 2048)}<label>Linked work<select name="itemId"><option value="">No linked task</option>${state.items
            .filter((t) => t.id !== taskId)
            .map(
              (t) =>
                `<option value="${esc(t.id)}" ${t.id === r.itemId ? 'selected' : ''}>${esc(t.title)}</option>`,
            )
            .join(
              '',
            )}</select></label>${r.itemId ? `<p>${['done', 'cancelled'].includes(state.items.find((t) => t.id === r.itemId)?.status ?? '') ? '✓ Linked work finished' : '◇ Linked work still needs finishing'} · <a href="/instructions/?workspace=${encodeURIComponent(workspace)}&task=${encodeURIComponent(r.itemId)}">Open requirement →</a></p>` : `<label><input type="checkbox" name="confirmed" ${r.confirmed ? 'checked' : ''}>I checked this requirement; it is ready.</label>`}${citations(r.citations)}${r.citations.length ? `<button type="button" data-action="clear-need-citations:${i}">Clear requirement citations</button>` : ''}<button type="button" data-action="remove-need:${i}">Remove requirement</button></fieldset>`,
      )
      .join('') || '<p>Check access, software, people, materials and information.</p>'
  }</form><div class="packet-toolbar"><button data-action="add-need">＋ Requirement</button><button class="primary" data-action="save">Save draft</button></div>`;
}
function questions() {
  return `<h2>Clear the unknowns.</h2><form id="questions-form" class="packet-form">${draft.questions.map((q, i) => `<fieldset data-question="${i}"><legend>${q.answer.trim() ? '✓ ANSWERED' : '◇ NEEDS ANSWER'}</legend>${input('question', 'Exact question', q.question, 'text', 240)}${area('resolve', 'Who / what can resolve it?', q.resolve)}${input('url', 'Source or contact link', q.url, 'url', 2048)}${link(q.url, 'Open source / contact ↗')}${area('answer', 'Confirmed answer — evidence or why it does not apply', q.answer)}${citations(q.citations)}${q.citations.length ? `<button type="button" data-action="clear-question-citations:${i}">Clear answer citations</button>` : ''}<button type="button" data-action="remove-question:${i}">Remove question</button></fieldset>`).join('') || '<p>Add any uncertainty before using these instructions.</p>'}</form><div class="packet-toolbar"><button data-action="add-question">＋ Question</button><button class="primary" data-action="save">Save draft</button></div>`;
}
function coverageQuestions() {
  for (const id of draft.sourceIds) {
    const s = source(id);
    if (s?.coverage === 'excerpt' && !draft.questions.some((q) => q.id === `coverage-${id}`))
      draft.questions.push({
        id: `coverage-${id}`,
        question: `Does ${s.title} include every relevant requirement?`.slice(0, 240),
        resolve:
          'Compare the original, including figures, tables and omitted sections. Capture anything missing; record what you checked.',
        url: instructionUrl(s.locator) ? s.locator : '',
        answer: '',
        citations: [],
      });
  }
}
function sources() {
  const context = packetContext(state, taskId),
    all = state.instructions?.sources ?? [];
  return `<h2>Bring the evidence here.</h2><p>${context.items.length} linked work records · ${context.links.length} links · ${context.sources.length} current captures</p><div class="packet-toolbar"><button data-action="capture-notes" ${reader ? 'disabled' : ''}>Capture task notes</button><button data-action="copy-prompt">Copy research brief</button><button data-action="download-context">↓ Context bundle</button><button data-action="coverage-questions" ${reader ? 'disabled' : ''}>Check source coverage</button></div><details><summary>Linked context</summary>${context.items.map((i) => `<h3>${esc(i.title)}</h3><p class="packet-context">${esc(i.description || 'No notes.')}</p>`).join('')}</details><ul class="packet-source-list">${context.links.map((l) => `<li>${l.captured ? '✓ CAPTURED' : '◇ CONTENTS NEEDED'}<p>${esc(l.url)}</p>${link(l.url, 'Open page ↗')} <button data-action="fetch-link:${esc(l.url)}" ${reader ? 'disabled' : ''}>Capture public page</button></li>`).join('')}</ul><div class="packet-source-capture"><h3>Capture a source</h3><p class="packet-limits">Files stay on this computer. PDF / DOCX extraction is text only. For signed-in sites, copy relevant content from the open page, then paste here.</p><input id="source-file" type="file" accept=".pdf,.docx,.txt,.md,.json,.html,.htm,.csv,.eml,.log" ${reader ? 'disabled' : ''}><form id="source-form" class="packet-form">${input('title', 'Source title', capture.title, 'text', 240)}${input('locator', 'Original URL, filename or email reference', capture.locator, 'text', 2048)}<div class="packet-fields"><label>Type<select name="kind">${['note', 'page', 'file', 'email'].map((k) => `<option ${capture.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label><label>Coverage<select name="coverage">${[
    ['excerpt', 'Relevant excerpt / text extraction'],
    ['complete', 'I checked: complete relevant contents'],
    ['unreadable', 'Unreadable / needs transcription'],
  ]
    .map(
      ([v, l]) => `<option value="${v}" ${capture.coverage === v ? 'selected' : ''}>${l}</option>`,
    )
    .join(
      '',
    )}</select></label></div>${area('content', 'Readable contents (180,000 characters per capture)', capture.content, 9, 180000)}<label>Replace an older capture<select name="replaces"><option value="">New source</option>${all
    .filter((s) => !all.some((n) => n.replaces === s.id))
    .map(
      (s) =>
        `<option value="${esc(s.id)}" ${capture.replaces === s.id ? 'selected' : ''}>${esc(s.title)}</option>`,
    )
    .join(
      '',
    )}</select></label></form>${warnings.map((w) => `<p class="danger">◇ ${esc(w)}</p>`).join('')}<div class="packet-toolbar"><button data-action="fetch-capture-url" ${reader ? 'disabled' : ''}>Capture URL</button><button data-action="paste-source" ${reader ? 'disabled' : ''}>Paste clipboard</button><button class="primary" data-action="save-source" ${reader ? 'disabled' : ''}>Save capture</button></div></div><h3>Captured references</h3><ul class="packet-source-list">${
    all
      .filter(
        (s) =>
          draft.sourceIds.includes(s.id) ||
          s.taskIds.includes(taskId) ||
          context.sources.some((c) => c.id === s.id),
      )
      .map(
        (s) =>
          `<li><strong>${esc(s.title)}</strong><p class="source-meta">${esc(s.kind)} · ${esc(s.coverage)} · ${esc(new Date(s.capturedAt).toLocaleString())} · ${esc(s.capturedBy)}${all.some((n) => n.replaces === s.id) ? ' · SUPERSEDED' : ''}</p><p>${esc(s.locator)}</p>${link(s.locator, 'Original ↗')}<button data-action="toggle-source:${esc(s.id)}" ${reader ? 'disabled' : ''}>${draft.sourceIds.includes(s.id) ? 'Remove from draft' : 'Use in draft'}</button><details><summary>Read captured contents</summary><pre>${esc(s.content || 'No readable content.')}</pre></details></li>`,
      )
      .join('') || '<li>No source captures yet.</li>'
  }</ul>`;
}
function finish() {
  const complete =
    !!packet &&
    !dirty &&
    !packetIssues(state, packet).length &&
    packet.steps.every((s) => packet!.checks.some((c) => c.stepId === s.id));
  return `<p class="eyebrow">THE FINISH LINE</p><h2>${esc(draft.outcome || 'Define the finished result.')}</h2><p>${esc(draft.finish || 'Define the final acceptance check.')}</p><div class="packet-check"><h3>✓ Final check</h3><p>Confirm the whole result matches the acceptance check above.</p><button class="primary" data-action="complete" ${complete && !reader && state.items.find((i) => i.id === taskId)?.status !== 'done' ? '' : 'disabled'}>${state.items.find((i) => i.id === taskId)?.status === 'done' ? '✓ Task complete' : '✓ Accept result and finish task'}</button></div><h3>Saved revisions</h3><ul>${
    (state.instructions?.packets ?? [])
      .filter((p) => p.taskId === taskId)
      .map(
        (p) =>
          `<li>Revision ${p.revision} · ${esc(new Date(p.createdAt).toLocaleString())} · ${p.review ? 'reviewed' : 'draft'} · ${p.checks.length}/${p.steps.length} checked <button data-action="export-revision:${esc(p.id)}">↓ Record</button></li>`,
      )
      .join('') || '<li>No saved revision.</li>'
  }</ul>`;
}
function printMarkup() {
  const p = dirty ? draft : (packet ?? draft),
    issues = packetIssues(state, p);
  return `<article class="packet-print"><p class="print-meta">STATEWORK · ${esc(state.workspace.title)} · ${esc(taskId)}</p><h1>${esc(p.title)}</h1><p class="print-meta">${'revision' in p ? `Revision ${p.revision} · ${esc(p.id)}` : 'UNSAVED DRAFT'} · Printed ${esc(new Date().toLocaleString())}</p><p class="print-alert">${issues.length ? 'DRAFT / NEEDS ATTENTION — resolve the gaps before use.' : 'REVIEWED INSTRUCTIONS — verify requirements still match before starting.'}</p><h2>Finished result</h2><p>${esc(p.outcome)}</p><h2>The route</h2><ol class="print-route">${p.steps.map((s, i) => `<li>□ ${i + 1}. ${esc(s.title)}${s.minutes !== null ? ` · ${s.minutes} min` : ''}</li>`).join('')}</ol><h2>Have ready</h2>${p.requirements.map((r) => `<section><h3>□ ${esc(r.label)}</h3><p>${esc(r.detail)}</p><p>Check: ${esc(r.check)}</p><p>${esc(r.url)}</p>${citations(r.citations)}</section>`).join('') || '<p>No listed prerequisites.</p>'}${issues.length ? `<h2>Resolve before use</h2><ul>${issues.map((i) => `<li>${esc(i.label)}</li>`).join('')}</ul>` : ''}${p.questions.length ? `<h2>Questions and decisions</h2>${p.questions.map((q) => `<h3>${esc(q.question)}</h3><p>${esc(q.answer || 'UNANSWERED')}<br>Resolve: ${esc(q.resolve)}<br>${esc(q.url)}</p>${citations(q.citations)}`).join('')}` : ''}${p.steps.map((s, i) => `<section class="print-step"><p class="print-meta">${esc(p.title)} · ${'revision' in p ? `Revision ${p.revision}` : 'Draft'} · Step ${i + 1}/${p.steps.length}</p><h2>${i + 1}. ${esc(s.title)}</h2>${s.requires.length ? `<p>Needs: ${esc(s.requires.map((id) => p.requirements.find((r) => r.id === id)?.label ?? id).join(', '))}</p>` : ''}<h3>Do this</h3><p>${esc(s.instruction)}</p><p>${esc(s.actionUrl)}</p><div class="print-check"><h3>□ Result matches</h3><p>${esc(s.expected)}</p><p>Evidence / initials / time: ____________________________</p></div><h3>If stuck</h3><p>${esc(s.ifBlocked)}</p><h3>Evidence</h3>${citations(s.citations)}</section>`).join('')}<section class="print-step"><h2>□ Accept the complete result</h2><p>${esc(p.finish)}</p><p>Result / delivery reference: ____________________________</p><p>Worker / date: ____________________________</p></section>${p.sourceIds
    .map((id) => source(id))
    .filter((s): s is WorkSource => !!s)
    .map(
      (s) =>
        `<section class="print-source"><h2>Reference: ${esc(s.title)}</h2><p class="print-meta">${esc(s.locator)}<br>Captured ${esc(s.capturedAt)} by ${esc(s.capturedBy)} · ${esc(s.coverage)} · ${esc(s.id)}</p><pre>${esc(s.content)}</pre></section>`,
    )
    .join(
      '',
    )}<p class="print-footer">This copy preserves the cited captures. The local app shows newer sources, requirements, reviews and completion records. Review records human approval; it cannot prove that all real-world requirements are known.</p></article>`;
}
function render() {
  const active =
    document.activeElement instanceof HTMLElement
      ? document.activeElement.dataset.action
      : undefined;
  if (!state || !draft) return;
  const issues = packetIssues(state, dirty ? draft : (packet ?? draft)),
    ready = !!packet && !dirty && !issues.length,
    checks = packet?.checks.length ?? 0;
  app.innerHTML = `<header class="packet-top"><a href="/spatial/">← Office</a><strong>statework <small>WORK PACKET</small></strong><a href="/">Classic views ↗</a></header><div class="packet-title" role="region" aria-label="Packet summary"><p class="eyebrow">${esc(state.workspace.title)} · ${reader ? 'READ ONLY' : 'ON THIS COMPUTER'}</p><h1>${esc(draft.title)}</h1><span class="packet-status ${ready ? 'ready' : ''}">${ready ? '✓ Ready to follow' : dirty ? '◇ Unsaved draft' : packet ? '◇ Needs attention' : '◇ Build instructions'}</span> <small>${packet ? `Revision ${packet.revision} · ` : ''}${checks}/${draft.steps.length} checked</small><div class="packet-meter" aria-hidden="true"><span style="width:${draft.steps.length ? (checks / draft.steps.length) * 100 : 0}%"></span></div></div><nav class="packet-toolbar" aria-label="Packet sections">${[
    ['follow', '▶ Follow'],
    ['needs', '◇ Needs first'],
    ['sources', '▤ Sources'],
    ['questions', '? Questions'],
    ['finish', '✓ Finish'],
  ]
    .map(
      ([id, label]) =>
        `<button data-action="${id}" aria-pressed="${section === id}">${label}</button>`,
    )
    .join(
      '',
    )}<button data-action="edit" ${reader ? 'disabled' : ''}>✎ Edit</button><button data-action="print">▤ Print / PDF</button><button data-action="export">↓ Packet</button></nav><p class="packet-notice ${error ? 'packet-error' : ''}" role="${error ? 'alert' : 'status'}">${esc(error || notice)}</p>${issues.length ? `<details class="packet-gaps" role="region" aria-label="Instruction gaps"><summary>◇ ${issues.length} checks before use</summary><ul>${issues.map((i) => `<li>${esc(i.label)}</li>`).join('')}</ul><div class="packet-toolbar"><button data-action="questions">Resolve questions</button>${issues.some((i) => i.code === 'stale') ? `<button data-action="rebase" ${reader ? 'disabled' : ''}>Reconcile with current context</button>` : ''}</div></details>` : ''}<div class="packet-grid"><aside><ol class="packet-route">${draft.steps.map((s, i) => `<li><button data-action="step:${i}" ${i === index ? 'aria-current="step"' : ''}><b>${packet?.checks.some((c) => c.stepId === s.id) ? '✓' : i + 1}</b><span>${esc(s.title)}</span></button></li>`).join('')}</ol><div class="packet-toolbar"><button data-action="review" ${!reader && packet && !dirty && packetIssues(state, packet, false).length === 0 && !packet.review ? '' : 'disabled'}>✓ Review and approve</button></div><details><summary>Optional assistance</summary><p>${esc(assistant.message)}</p><button data-action="draft" ${reader || !assistant.available || job ? 'disabled' : ''}>Draft with Codex</button>${job ? '<p role="status">Preparing a draft…</p><button data-action="cancel-draft">Cancel draft</button>' : ''}${proposal ? '<p>Draft ready for inspection.</p><button data-action="use-proposal">Inspect Codex draft</button>' : ''}${previousDraft ? '<button data-action="restore-draft">Restore previous draft</button>' : ''}<div class="packet-toolbar"><button data-action="copy-prompt">Copy research brief</button><label class="button">Import packet<input id="import-packet" type="file" accept=".json" ${reader ? 'disabled' : ''}></label></div><p class="packet-limits">Account limits never prevent manual authoring.</p></details></aside><main class="packet-sheet" id="packet-main" tabindex="-1">${({ follow, edit, needs, sources, questions, finish }[section] ?? follow)()}</main></div><footer class="packet-bottom">A clear action. A visible result. Evidence within reach.</footer>${printMarkup()}`;
  if (busy) app.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled = true));
  if (reader)
    app
      .querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >('.packet-form input,.packet-form textarea,.packet-form select')
      .forEach((e) => (e.disabled = true));
  if (active) {
    const target = app.querySelector<HTMLButtonElement>(`[data-action="${CSS.escape(active)}"]`);
    if (target && !target.disabled) target.focus({ preventScroll: true });
    else document.querySelector<HTMLElement>('#packet-main')?.focus({ preventScroll: true });
  }
}
function collect() {
  const f = document.querySelector<HTMLFormElement>('#packet-form');
  if (f) {
    const d = new FormData(f);
    draft.title = String(d.get('title'));
    draft.outcome = String(d.get('outcome'));
    draft.finish = String(d.get('finish'));
    const s = current();
    if (s) {
      s.title = String(d.get('step-title'));
      s.instruction = String(d.get('instruction'));
      s.expected = String(d.get('expected'));
      s.ifBlocked = String(d.get('ifBlocked'));
      s.minutes = d.get('minutes') === '' ? null : Number(d.get('minutes'));
      s.actionUrl = String(d.get('actionUrl'));
      s.requires = d.getAll('requires').map(String);
    }
  }
  for (const e of app.querySelectorAll<HTMLFieldSetElement>('[data-need]')) {
    const r = draft.requirements[Number(e.dataset.need)]!;
    const v = (n: string) =>
      e.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${n}"]`)?.value ?? '';
    Object.assign(r, {
      label: v('label'),
      detail: v('detail'),
      kind: v('kind'),
      url: v('url'),
      check: v('check'),
      itemId: v('itemId') || null,
      confirmed: e.querySelector<HTMLInputElement>('[name="confirmed"]')?.checked ?? false,
    });
  }
  for (const e of app.querySelectorAll<HTMLFieldSetElement>('[data-question]')) {
    const q = draft.questions[Number(e.dataset.question)]!;
    for (const k of ['question', 'resolve', 'url', 'answer'] as const)
      q[k] = e.querySelector<HTMLInputElement>(`[name="${k}"]`)?.value ?? '';
  }
  const sf = document.querySelector<HTMLFormElement>('#source-form');
  if (sf) {
    const d = new FormData(sf);
    capture = {
      title: String(d.get('title')),
      locator: String(d.get('locator')),
      content: String(d.get('content')),
      kind: d.get('kind') as SourceInput['kind'],
      coverage: d.get('coverage') as SourceInput['coverage'],
      replaces: String(d.get('replaces')) || null,
    };
  }
}
function download(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function bundle(p: PacketInput | WorkPacket) {
  return {
    format: 'statework.packet',
    formatVersion: 1,
    packet: p,
    sources: (state.instructions?.sources ?? []).filter((s) => p.sourceIds.includes(s.id)),
  };
}
async function captureSources(inputs: SourceInput[]) {
  const validated = inputs.map((s) => parse(sourceInputSchema, s));
  for (const s of validated) {
    const existing = source(s.id);
    if (existing) {
      const saved = Object.fromEntries(
        Object.keys(sourceInputSchema.shape).map((k) => [k, existing[k as keyof SourceInput]]),
      );
      if (JSON.stringify(saved) !== JSON.stringify(s))
        throw new Error('A capture with this ID has different content. Import it as a new source.');
    } else await execute([{ type: 'source.capture', source: s }]);
  }
  draft.contextKey = packetContext(state, taskId).key;
  draft.sourceIds = [...new Set([...draft.sourceIds, ...inputs.map((s) => s.id)])];
  const superseded = new Set(inputs.map((s) => s.replaces).filter(Boolean));
  draft.sourceIds = draft.sourceIds.filter((id) => !superseded.has(id));
  draft.questions = draft.questions.filter(
    (q) => ![...superseded].some((id) => q.id === `coverage-${id}`),
  );
  coverageQuestions();
  remember();
}
function toInput(p: WorkPacket | PacketInput): PacketInput {
  return parse(
    packetInputSchema,
    Object.fromEntries(
      Object.keys(packetInputSchema.shape).map((k) => [k, p[k as keyof PacketInput]]),
    ),
  );
}
async function save() {
  const own = document.querySelector<HTMLInputElement>('#own-instructions')?.checked;
  if (pendingSources.length) {
    await captureSources(pendingSources);
    pendingSources = [];
  }
  if (own) {
    const steps = draft.steps.filter((s) => !s.citations.length && s.instruction.trim());
    if (steps.length) {
      const s: SourceInput = {
        id: uid(),
        taskIds: [taskId],
        title: `Author instructions — ${draft.title}`.slice(0, 240),
        locator: 'Original instructions entered by the local author',
        content: steps
          .map(
            (s) =>
              `${s.id} — ${s.title}\n${s.instruction}\nResult: ${s.expected}\nRecovery: ${s.ifBlocked}`,
          )
          .join('\n\n'),
        kind: 'note',
        coverage: 'complete',
        replaces: null,
      };
      await captureSources([s]);
      for (const step of steps)
        step.citations.push({ sourceId: s.id, quote: step.instruction, location: step.id });
    }
  }
  const value = parse(packetInputSchema, { ...draft, id: uid() });
  await execute([{ type: 'packet.save', packet: value, expectedPacketId: packet?.id ?? null }]);
  draft = toInput(packet!);
  clearDraft();
  notice = 'Draft saved. Resolve the checks, then review the complete instructions.';
}
async function poll() {
  if (!job) return;
  const requestedJob = job;
  try {
    const result = await client.draftStatus(workspace, requestedJob);
    if (job !== requestedJob) return;
    if (result.state === 'running') {
      polling = setTimeout(() => void poll(), 2500);
      return;
    }
    job = '';
    if (result.state === 'done' && result.packet) {
      proposal = result.packet;
      notice = 'Codex draft is ready. Inspect it before replacing your working draft.';
    } else error = result.error ?? 'Draft cancelled.';
    render();
  } catch (e) {
    if (job !== requestedJob) return;
    if (e instanceof WorkError && e.code === 'NOT_FOUND') job = '';
    else polling = setTimeout(() => void poll(), 10000);
    setError(e);
    render();
  }
}
async function action(a: string) {
  collect();
  if (a === 'fetch-capture-url') {
    if (!/^https?:\/\//i.test(capture.locator))
      throw new Error('Enter a public URL in Original URL first.');
    a = `fetch-link:${capture.locator}`;
  }
  error = '';
  notice = '';
  if (['follow', 'edit', 'needs', 'sources', 'questions', 'finish'].includes(a)) {
    section = a;
    render();
    return;
  }
  if (a.startsWith('step:')) {
    index = Number(a.slice(5));
    if (section !== 'edit') section = 'follow';
    render();
    return;
  }
  if (a === 'previous' || a === 'next') {
    index = Math.max(0, Math.min(draft.steps.length - 1, index + (a === 'next' ? 1 : -1)));
    render();
    return;
  }
  if (a === 'print') {
    render();
    window.print();
    return;
  }
  if (a === 'export') {
    download(bundle(dirty ? draft : (packet ?? draft)), `statework-packet-${taskId}.json`);
    return;
  }
  if (a.startsWith('export-revision:')) {
    const p = state.instructions?.packets.find((p) => p.id === a.slice(16));
    if (p) download(bundle(p), `statework-packet-${taskId}-r${p.revision}.json`);
    return;
  }
  if (a === 'download-context') {
    download(packetContext(state, taskId), `statework-context-${taskId}.json`);
    return;
  }
  if (a === 'copy-prompt') {
    const p = await client.instructionPrompt(workspace, taskId);
    await navigator.clipboard.writeText(p.prompt);
    notice =
      'Research brief copied. Paste into an authorized assistant; its connected tools determine private source access.';
    render();
    return;
  }
  if (reader) throw new Error('This workspace is read-only.');
  if (a === 'add-step') {
    draft.steps.push({
      id: uid(),
      title: 'New action',
      instruction: '',
      expected: '',
      ifBlocked: '',
      minutes: null,
      actionUrl: '',
      requires: [],
      citations: [],
    });
    index = draft.steps.length - 1;
    section = 'edit';
    remember();
  } else if (a === 'remove-step') {
    draft.steps.splice(index, 1);
    index = Math.max(0, index - 1);
    remember();
  } else if (a === 'move-up' || a === 'move-down') {
    const next = index + (a === 'move-up' ? -1 : 1);
    if (next >= 0 && next < draft.steps.length) {
      [draft.steps[index], draft.steps[next]] = [draft.steps[next]!, draft.steps[index]!];
      index = next;
      remember();
    }
  } else if (a.startsWith('remove-citation:')) {
    current()?.citations.splice(Number(a.slice(16)), 1);
    remember();
  } else if (a === 'cite-selection') {
    const quote = getSelection()?.toString() ?? '',
      s = source(citeSource),
      location = document.querySelector<HTMLInputElement>('[name="cite-location"]')?.value ?? '';
    if (!quote || quote.length > 12000 || !s?.content.includes(quote))
      throw new Error('Select a passage of up to 12,000 characters from the captured source.');
    if (!location.trim()) throw new Error('Add its page or section location.');
    current()?.citations.push({ sourceId: s.id, quote, location });
    remember();
  } else if (a === 'add-need') {
    draft.requirements.push({
      id: uid(),
      label: 'New requirement',
      detail: '',
      kind: 'information',
      itemId: null,
      url: '',
      check: '',
      confirmed: false,
      citations: [],
    });
    remember();
  } else if (a.startsWith('remove-need:')) {
    const removed = draft.requirements.splice(Number(a.slice(12)), 1)[0];
    for (const step of draft.steps)
      step.requires = step.requires.filter((id) => id !== removed?.id);
    remember();
  } else if (a === 'add-question' || a === 'question-for-step') {
    draft.questions.push({
      id: uid(),
      question:
        a === 'question-for-step'
          ? `What is missing from ${current()?.title ?? 'this step'}?`.slice(0, 240)
          : 'What needs clarification?',
      resolve: '',
      url: '',
      answer: '',
      citations: [],
    });
    section = 'questions';
    remember();
  } else if (a.startsWith('remove-question:')) {
    draft.questions.splice(Number(a.slice(16)), 1);
    remember();
  } else if (a.startsWith('clear-need-citations:')) {
    draft.requirements[Number(a.slice(21))]!.citations = [];
    remember();
  } else if (a.startsWith('clear-question-citations:')) {
    draft.questions[Number(a.slice(25))]!.citations = [];
    remember();
  } else if (a === 'coverage-questions') {
    coverageQuestions();
    section = 'questions';
    remember();
  } else if (a.startsWith('toggle-source:')) {
    const id = a.slice(14);
    if (draft.sourceIds.includes(id)) {
      draft.sourceIds = draft.sourceIds.filter((s) => s !== id);
      for (const part of [...draft.steps, ...draft.requirements, ...draft.questions])
        part.citations = part.citations.filter((c) => c.sourceId !== id);
      draft.questions = draft.questions.filter((q) => q.id !== `coverage-${id}`);
      notice =
        'Source removed from this draft; its citations were cleared. Saved history is preserved.';
    } else {
      draft.sourceIds.push(id);
      coverageQuestions();
    }
    remember();
  } else if (a === 'rebase') {
    const context = packetContext(state, taskId);
    draft.contextKey = context.key;
    for (const r of blankPacket(state, taskId, uid()).requirements)
      if (!draft.requirements.some((old) => old.itemId === r.itemId))
        draft.requirements.push({ ...r, id: uid() });
    draft.sourceIds = [...new Set([...draft.sourceIds, ...context.sources.map((s) => s.id)])];
    coverageQuestions();
    remember();
    notice =
      'Current context attached. Compare changed notes and sources, revise actions, then save and review again.';
    section = 'sources';
  } else if (a === 'use-proposal' && proposal) {
    previousDraft = {
      draft: structuredClone(draft),
      pendingSources: structuredClone(pendingSources),
    };
    draft = proposal;
    coverageQuestions();
    proposal = null;
    index = 0;
    section = 'edit';
    remember();
    notice = 'Inspect the proposed route and evidence. No task or completion record changed.';
  } else if (a === 'restore-draft' && previousDraft) {
    draft = previousDraft.draft;
    pendingSources = previousDraft.pendingSources;
    previousDraft = null;
    index = 0;
    section = 'edit';
    remember();
    notice = 'Previous working draft restored.';
  } else if (a === 'paste-source') {
    capture.content = await navigator.clipboard.readText();
    if (capture.content.length > 180000)
      throw new Error('Clipboard text exceeds the capture limit. Paste a smaller named section.');
  } else {
    const evidence = document.querySelector<HTMLInputElement>('#check-evidence')?.value ?? '';
    busy = true;
    app.querySelectorAll<HTMLButtonElement>('button').forEach((b) => (b.disabled = true));
    try {
      if (a === 'save') await save();
      else if (a === 'review') {
        if (dirty || !packet) throw new Error('Save the draft before reviewing.');
        await execute([{ type: 'packet.review', id: packet.id }]);
        draft = toInput(packet!);
        notice = 'Reviewed. Follow the route and check results.';
        section = 'follow';
      } else if (a === 'check') {
        const s = current();
        if (!packet || !s || dirty) throw new Error('Save and review this packet first.');
        const checked = !packet.checks.some((c) => c.stepId === s.id);
        await execute([{ type: 'packet.check', id: packet.id, stepId: s.id, checked, evidence }]);
        if (checked && index < draft.steps.length - 1) index++;
        else if (checked) section = 'finish';
        notice = checked
          ? 'Result recorded.'
          : 'This and later checks reset; event history preserved.';
      } else if (a === 'complete') {
        if (!packet) throw new Error('Save the packet first.');
        await execute([packetCompleteCommand(state, packet.id)]);
        notice = 'Task complete. Instructions, sources and result records are preserved.';
      } else if (a === 'capture-notes') {
        const inputs = packetContext(state, taskId)
          .items.filter((i) => i.description.trim())
          .map((i) => ({
            id: uid(),
            taskIds: [i.id],
            title: `Task notes — ${i.title}`.slice(0, 240),
            locator: `StateWork item ${i.id}, version ${i.version}`,
            content: i.description,
            kind: 'note' as const,
            coverage: 'complete' as const,
            replaces: null,
          }));
        if (!inputs.length) throw new Error('These records have no notes to capture.');
        await captureSources(inputs);
        notice = `Captured ${inputs.length} note sources.`;
      } else if (a === 'save-source') {
        await captureSources([{ id: uid(), taskIds: [taskId], ...capture }]);
        capture = {
          title: '',
          locator: '',
          content: '',
          kind: 'note',
          coverage: 'excerpt',
          replaces: null,
        };
        warnings = [];
        notice = 'Source captured. Earlier captures remain in the record.';
      } else if (a.startsWith('fetch-link:')) {
        const url = a.slice(11),
          result = await client.fetchSource(workspace, url);
        capture = {
          title: new URL(url).hostname,
          locator: url,
          content: result.html ? htmlText(result.content) : result.content,
          kind: 'page',
          coverage: 'excerpt',
          replaces: null,
        };
        warnings = result.warnings;
        section = 'sources';
        notice = 'Preview the captured contents, then save.';
      } else if (a === 'draft') {
        job = (await client.draftInstructions(workspace, taskId)).id;
        void poll();
        notice = 'Codex is preparing a draft from selected context and captures.';
      } else if (a === 'cancel-draft') {
        await client.cancelDraft(workspace, job);
        job = '';
        if (polling) clearTimeout(polling);
        notice = 'Draft cancelled. Your work is unchanged.';
      }
    } finally {
      busy = false;
    }
  }
  render();
}
function htmlText(html: string) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,noscript,iframe,object,nav,footer').forEach((e) => e.remove());
  doc.querySelectorAll('p,div,li,h1,h2,h3,h4,tr,br').forEach((e) => e.append('\n'));
  return (doc.body.textContent ?? '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
}
app.addEventListener('click', (e) => {
  const b = (e.target as Element).closest<HTMLElement>('[data-action]');
  if (!b || busy) return;
  e.preventDefault();
  void action(b.dataset.action!).catch((e) => {
    setError(e);
    busy = false;
    render();
  });
});
app.addEventListener('input', (e) => {
  const el = e.target as Element;
  if (el.closest('#packet-form,#needs-form,#questions-form')) {
    collect();
    remember();
  }
  if (el.closest('#source-form')) collect();
});
app.addEventListener('change', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === 'cite-source') {
    collect();
    citeSource = el.value;
    render();
  }
  if (el.id === 'source-file' && el.files?.[0]) void readSourceFile(el.files[0]);
  if (el.id === 'import-packet' && el.files?.[0]) void importPacket(el.files[0]);
  if (el.closest('#needs-form,#packet-form,#questions-form')) {
    collect();
    remember();
  }
});
app.addEventListener('submit', (e) => e.preventDefault());
window.addEventListener('beforeunload', (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});
async function readSourceFile(file: File) {
  collect();
  busy = true;
  error = '';
  render();
  try {
    if (file.size > 8 * 1024 * 1024)
      throw new Error('File exceeds 8 MiB. Split it into smaller sources.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const r = await client.extractSource(workspace, file.name, btoa(binary));
    capture = {
      title: file.name,
      locator: file.name,
      content: /\.html?$/i.test(file.name) ? htmlText(r.content) : r.content,
      kind: 'file',
      coverage: 'excerpt',
      replaces: null,
    };
    warnings = r.warnings;
    notice = 'File read locally. Check it, then save the capture.';
  } catch (e) {
    setError(e);
  } finally {
    busy = false;
    render();
  }
}
async function importPacket(file: File) {
  try {
    collect();
    if (file.size > 12 * 1024 * 1024)
      throw new Error('Packet import exceeds 12 MiB. Import fewer source sections.');
    const value = JSON.parse(await file.text());
    if (value.format !== 'statework.packet' || value.formatVersion !== 1)
      throw new Error('Choose a StateWork packet export.');
    const p = toInput(value.packet);
    pendingSources = [];
    const remap = new Map<string, string>();
    for (const raw of value.sources ?? []) {
      const s = parse(
        sourceInputSchema,
        Object.fromEntries(Object.keys(sourceInputSchema.shape).map((k) => [k, raw[k]])),
      );
      const existing = source(s.id);
      if (existing && existing.content === s.content && existing.locator === s.locator) {
        remap.set(s.id, s.id);
        continue;
      }
      const id = uid();
      remap.set(s.id, id);
      pendingSources.push({ ...s, id, taskIds: [taskId], replaces: null });
    }
    for (const part of [...p.steps, ...p.requirements, ...p.questions])
      for (const c of part.citations) c.sourceId = remap.get(c.sourceId) ?? c.sourceId;
    p.sourceIds = p.sourceIds.map((id) => remap.get(id) ?? id);
    for (const r of p.requirements) {
      r.confirmed = false;
      if (r.itemId && !state.items.some((i) => i.id === r.itemId)) r.itemId = null;
    }
    draft = {
      ...p,
      id: uid(),
      taskId,
      contextKey: packetContext(state, taskId).key,
      origin: 'import',
    };
    index = 0;
    section = 'edit';
    remember();
    notice = `Imported draft. ${pendingSources.length} captures will be added on save. Reviews and checks are not imported.`;
    render();
  } catch (e) {
    setError(e);
    render();
  }
}
async function start() {
  app.innerHTML = '<p role="status">Opening work instructions…</p>';
  const response = await fetch('/local/session', {
    method: 'POST',
    headers: { 'X-StateWork-Local': '1' },
  });
  if (!response.ok) throw new Error('Open StateWork on its local address to use packets.');
  client = new WorkClient('', (await response.json()).token);
  const spaces = await client.list();
  if (!workspace) workspace = spaces[0]?.id ?? '';
  if (!workspace) throw new Error('Create a workspace in the office first.');
  reader = spaces.find((s) => s.id === workspace)?.role === 'reader';
  state = await client.snapshot(workspace);
  if (!taskId) {
    app.innerHTML = `<header class="packet-top"><a href="/spatial/">← Office</a><h1>Choose a task.</h1></header><div class="packet-taskselect"><label>Workspace<select id="choose-workspace">${spaces.map((s) => `<option value="${esc(s.id)}" ${s.id === workspace ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}</select></label><ul class="packet-route">${state.items
      .filter((i) => i.kind === 'task' && !i.archived)
      .map(
        (i) =>
          `<li><a class="button" href="?workspace=${encodeURIComponent(workspace)}&task=${encodeURIComponent(i.id)}">${esc(i.title)}</a></li>`,
      )
      .join('')}</ul></div>`;
    document
      .querySelector('#choose-workspace')
      ?.addEventListener('change', (e) =>
        location.assign(`?workspace=${encodeURIComponent((e.target as HTMLSelectElement).value)}`),
      );
    return;
  }
  packet = latestPacket(state, taskId) ?? null;
  draft = packet ? toInput(packet) : blankPacket(state, taskId, uid());
  if (!packet) section = 'sources';
  try {
    const saved = sessionStorage.getItem(storageKey());
    if (saved) {
      const recovered = JSON.parse(saved);
      draft = parse(packetInputSchema, recovered.draft ?? recovered);
      pendingSources = (recovered.pendingSources ?? []).map((s: unknown) =>
        parse(sourceInputSchema, s),
      );
      if (recovered.previousDraft)
        previousDraft = {
          draft: parse(packetInputSchema, recovered.previousDraft.draft),
          pendingSources: (recovered.previousDraft.pendingSources ?? []).map((s: unknown) =>
            parse(sourceInputSchema, s),
          ),
        };
      dirty = true;
      notice = 'Recovered your unsaved draft.';
    }
  } catch {
    /* Invalid recovery data cannot replace saved work. */
  }
  assistant = await client.assistant(workspace);
  render();
}
void start().catch((e) => {
  app.innerHTML = `<header class="packet-top"><a href="/spatial/">← Office</a></header><h1>Could not open instructions.</h1><p role="alert">${esc(e instanceof Error ? e.message : e)}</p><button id="reload">Try again</button>`;
  document.querySelector('#reload')?.addEventListener('click', () => location.reload());
});
