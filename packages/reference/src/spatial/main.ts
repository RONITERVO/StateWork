import {
  WorkClient,
  WorkError,
  observe,
  queryItems,
  latestPacket,
  packetIssues,
} from '@statework/sdk';
import type {
  Command,
  CommandRequest,
  Role,
  SemanticNode,
  WorkItem,
  WorkState,
  WorkerHandoff,
  WorkerContext,
} from '@statework/sdk';
import {
  marks,
  nextTask,
  resourceFor,
  resourceNamespace,
  safeResource,
  semanticNodes,
  starterSnapshot,
  starterTasks,
  stateMark,
  statusCommand,
  visibleNodes,
} from './model';
import type { Filter } from './model';
import type { SpatialScene, SpatialView } from './scene';
import { officeCatalog } from './office-model';
import type { OfficeCatalog } from './office-model';
import type { OfficeFeedback } from './office-world';
import { DetectiveBoard } from './detective-board';
import { WorkCalendar } from './calendar';
import { packetDeskView } from './packet-view';
import './calendar.css';
import './style.css';
import './office.css';
import './detective.css';

const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;
const esc = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const uid = () => crypto.randomUUID();
const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(`statework.spatial.${key}`, value);
  } catch {
    /* Work is stored in SQLite; preferences are optional. */
  }
};
const recalled = (key: string) => {
  try {
    return localStorage.getItem(`statework.spatial.${key}`) ?? '';
  } catch {
    return '';
  }
};
let client: WorkClient;
let spaces: Awaited<ReturnType<WorkClient['list']>> = [];
let workspaceId = recalled('workspace');
let state: WorkState | undefined;
let worker: WorkerContext = {};
let filing: OfficeCatalog | undefined;
let nodes: SemanticNode[] = [];
let role: Role = 'reader';
let selected = '';
let filter: Filter = 'all';
let search = '';
let page = 0;
let busy = false;
let scene: SpatialScene | undefined;
let immersive = false;
let message = '';
let failure = '';
let large = recalled('large') === 'true';
let movement = recalled('movement') !== 'false';
// Audio always starts silent, even on a shared browser. Opt in once each visit.
let sound = false;
let audioContext: AudioContext | undefined;
let detailPage = 0;
let packetOpen = false;
let packetStep = 0;
let packetPage = 0;
let packetTask = '';
let packetHandoff: WorkerHandoff | null = null;
let relationPage = 0;
let pending: { workspace: string; request: CommandRequest } | null = null;
let setupPending: {
  snapshot: ReturnType<typeof starterSnapshot>;
  target: { id: string; title: string };
} | null = null;
let undo: {
  workspace: string;
  itemId: string;
  status: WorkItem['status'];
  version: number;
} | null = null;
let lastFocus: HTMLElement | null = null;

$('#app').innerHTML =
  `<header class="topbar"><a class="brand" href="/spatial/" aria-label="StateWork Spatial home"><svg viewBox="0 0 40 40" fill="none" aria-hidden="true"><path d="M20 3 36 12v16L20 37 4 28V12L20 3Z" stroke="#9fe2c7" stroke-width="2"/><path d="m4 12 16 9 16-9M20 21v16" stroke="#9fe2c7" stroke-width="2"/><circle cx="20" cy="20" r="4" fill="#9fe2c7"/></svg>statework <span>SPATIAL</span></a><div class="actions"><span class="local">● On this computer</span><button data-action="help">How it works</button><a class="button" href="/" id="flat-link">Classic views ↗</a></div></header>
<div class="layout"><aside class="rail" aria-label="Workspace navigation"><label>Your workspace<select id="workspace"><option value="">Choose a space</option></select></label><button data-action="setup">＋ New space</button><nav aria-label="Work filters">${(
    [
      ['all', '▦', 'All work'],
      ['ready', '○', 'Ready'],
      ['waiting', '◇', 'Needs first'],
      ['done', '✓', 'Finished'],
    ] as const
  )
    .map(
      ([id, icon, label]) =>
        `<button data-filter="${id}" aria-pressed="${id === 'all'}"><span aria-hidden="true">${icon}</span> ${label}</button>`,
    )
    .join('')}</nav><div class="legend">${Object.values(marks)
    .slice(0, 4)
    .map(
      (m) =>
        `<span><b style="color:${m.color}" aria-hidden="true">${m.symbol}</b>${m.label}</span>`,
    )
    .join(
      '',
    )}</div><div class="rail-bottom"><p class="eyebrow">MAKE IT YOURS</p><button data-action="comfort">Comfort</button><button data-action="export">↓ Export work</button><p class="muted"><small>Same work. Every view.<br>No account needed.</small></p></div></aside>
<main id="main" tabindex="-1"><div class="heading"><div><p class="eyebrow">YOUR WORK, WITHIN REACH</p><h1 id="space-title">Make room to think.</h1><p class="muted" id="space-subtitle">One clear step. The whole picture nearby.</p></div><div class="actions"><button data-action="refresh" aria-label="Refresh work">↻</button><button data-action="add" class="primary" id="add-work">＋ Add step</button></div></div><p id="notice" class="status" role="status" aria-live="polite"></p><p id="error" class="error" role="alert" hidden></p><button id="retry" data-action="retry-save" hidden>Retry save</button>
<section id="intro" class="intro" hidden><p class="eyebrow">A SPACE OF YOUR OWN</p><h2>Put your next project<br>in front of you.</h2><p class="muted">Name it. Add a few steps. See what is ready and what needs to happen first.</p><div class="actions"><button class="primary" data-action="setup">Create your space →</button><button data-action="help">Explore the controls</button></div><p class="muted" style="margin-top:24px;margin-bottom:0"><small>Use your screen now. Enter VR when a compatible headset is connected.</small></p></section>
<div id="work" class="work-grid" hidden><div class="work-main"><section class="stage" aria-label="Spatial preview"><div class="stage-top"><p class="eyebrow">YOUR WORK MAP</p><div class="actions"><button data-action="comfort" aria-label="Comfort settings">Comfort</button><button id="enter-vr" data-action="enter" class="primary" disabled>Checking VR…</button></div></div><div id="scene"><p class="scene-error muted" id="scene-loading">Preparing the spatial view…</p></div><div class="scene-caption"><span id="xr-status">Checking this browser</span><span>Open · Hold · Follow keys</span></div></section><section class="task-index" aria-label="Work buttons"><div class="index-heading"><h2 id="index-title">All work</h2><label class="sr-only" for="find">Find a step</label><input id="find" type="search" placeholder="Find a step…" maxlength="240"></div><div id="cards" class="cards"></div><div id="pages" class="pagination"></div></section></div><aside class="work-aside" aria-label="Your direction"><section id="next-card" class="next-card"></section><section id="inspector" class="inspector" aria-label="Selected step"></section></aside></div>
<footer class="footnote"><span id="record-count">Your work stays local.</span><div class="actions"><button data-action="export">Export</button><button data-action="audio" id="sound-toggle" aria-pressed="false">Sound off</button></div></footer></main></div>
<dialog id="setup-dialog" aria-labelledby="setup-title"><form id="setup-form"><div class="dialog-heading"><div><p class="eyebrow">JUST FILL IN</p><h2 id="setup-title">Your space starts here.</h2></div><button type="button" data-close aria-label="Close setup">×</button></div><p class="muted">Edit the example, or start with a blank project. Nothing is saved until you create it.</p><div class="template-options"><button type="button" data-template="project" aria-pressed="true">◇ 3D project</button><button type="button" data-template="blank" aria-pressed="false">＋ Blank</button></div><label>Workspace name<input name="workspaceName" required maxlength="240" value="My studio"></label><label>Project name<input name="projectName" required maxlength="240" value="My next release"></label><fieldset><legend>Starting steps <small>— edit or leave empty</small></legend>${Array.from({ length: 5 }, (_, i) => `<label>Step ${i + 1}<input name="step${i}" maxlength="240" value="${starterTasks[i]}"></label>`).join('')}</fieldset><p class="muted"><small>The unchanged example links access → build → review → deliver. Editing the steps starts them independently; add prerequisites inside your space.</small></p><p class="form-error error" role="alert" hidden></p><div class="dialog-footer"><button type="button" data-close>Cancel</button><button class="primary" type="submit">Create space</button></div></form></dialog>
<dialog id="edit-dialog" aria-labelledby="edit-title"><form id="edit-form"><div class="dialog-heading"><h2 id="edit-title">Add a step</h2><button type="button" data-close aria-label="Close step editor">×</button></div><input name="itemId" type="hidden"><label>Step name<input name="title" required maxlength="240" placeholder="A small, clear action"></label><div class="form-grid"><label>Kind<select name="kind"><option value="task">Task</option><option value="project">Project</option><option value="note">Note</option><option value="event">Event</option></select></label><label>Priority<select name="priority"><option value="1">Normal</option><option value="3">High</option><option value="2">Medium</option><option value="0">Low</option></select></label><label>Minutes<input name="minutes" type="number" min="0" max="525600"></label><label>Due date<input name="dueDate" type="date"></label></div><label>Notes / microsteps<textarea name="description" rows="4" maxlength="20000" placeholder="Keep the next action small."></textarea></label><label>Resource link<input name="resource" type="url" maxlength="2048" placeholder="https://…"></label><label id="parent-label">Inside project<select name="parent"><option value="">No project</option></select></label><p class="form-error error" role="alert" hidden></p><div class="dialog-footer"><button type="button" data-close>Cancel</button><button type="submit" class="primary">Save step</button></div></form></dialog>
<dialog id="needs-dialog" aria-labelledby="needs-title"><form id="needs-form"><div class="dialog-heading"><h2 id="needs-title">What needs to happen first?</h2><button type="button" data-close aria-label="Close prerequisites">×</button></div><p class="muted">An account, tool, person or small task can be a prerequisite. Link an existing step, or create one.</p><label>Existing prerequisite<select name="existing"><option value="">Create a new prerequisite</option></select></label><label>New prerequisite<input name="title" maxlength="240" placeholder="Get project access"></label><label>Link to get it<input name="resource" type="url" maxlength="2048" placeholder="https://…"></label><p class="form-error error" role="alert" hidden></p><div class="dialog-footer"><button type="button" data-close>Cancel</button><button type="submit" class="primary">Link prerequisite</button></div></form></dialog>
<dialog id="comfort-dialog" aria-labelledby="comfort-title"><div class="dialog-heading"><h2 id="comfort-title">Make yourself comfortable.</h2><button data-close aria-label="Close comfort settings">×</button></div><p class="muted">Sit or stand. The desk and board have one-click stations. Free movement is optional; no dragging or timed selection is required.</p><div class="actions"><button data-action="large" id="large-toggle" aria-pressed="${large}">Larger VR text</button><button data-action="recenter">Recenter view</button><button data-action="audio" id="comfort-sound" aria-pressed="false">Sound off</button></div><p style="margin-top:20px" class="muted">Sound adds a short cue for interactions and successful saves. Every cue has a visible message. No microphone or speech service is used.</p><p class="muted">Use Classic views for adjustable text size, high contrast and a full text view. Your headset’s system control can always leave VR.</p></dialog>
<dialog id="help-dialog" aria-labelledby="help-title"><div class="dialog-heading"><h2 id="help-title">A place for your next step.</h2><button data-close aria-label="Close help">×</button></div><p><strong>1. Fill in</strong> a workspace and a few steps.</p><p><strong>2. Open a drawer</strong> and pick up a folder. Dependencies reveals its missing keys; Quick View brings related files forward.</p><p><strong>3. Start → Finish.</strong> Completed work stays in your records.</p><h3>Inside VR</h3><p>Point either controller and select a drawer, folder or key. Squeeze to grab nearby; release or choose Put down. Follow Dependencies → Quick View, earn keys by finishing requirements, then use the key ring and Done stamp. Back to folder retraces your path; File all tidies the office. The telephone brings your next step without making a call. Recenter, text size, sound and exit are on the control board. The right-wall detective board shows the whole case. Open groups, follow Needs first or What follows, and pin files to remember. Left stick moves; right stick turns 45°. With one controller, its stick moves and the wall buttons turn. Pause free movement at any time. On desktop: WASD, Q/E and right-drag. Setup and editing use browser forms outside VR.</p><h3>Connect a headset</h3><p>Run StateWork on your PC and open this localhost address in a WebXR-capable browser connected to your headset. “Enter VR” becomes available when that browser reports immersive VR support.</p><p class="muted">This server is local to your PC. A standalone headset cannot reach the PC using its own localhost address. Standalone / company hosting requires a separate authenticated HTTPS host. This release does not provide remote access or sync.</p><h3>Your data</h3><p>Saved in the local StateWork database. Export a snapshot before moving computers. Import, archive, schedules and the complete history are available through Classic views and the shared API.</p><p class="muted">Headset comfort and device compatibility still need real hardware testing. The desktop preview is available even without VR.</p></dialog>`;

const caseBoard = new DetectiveBoard(
  () => updateScene(),
  (id) => setSelection(id, true),
  (id) => {
    setSelection(id, true);
    scene?.officeAction('office:hold');
  },
);
const calendar = new WorkCalendar(
  () => render(),
  (id) => setSelection(id, true),
  (id) => {
    setSelection(id, true);
    scene?.officeAction('office:hold');
  },
  async (commands) => {
    if (busy) throw new Error('Wait for the current save.');
    busy = true;
    render();
    try {
      await command(commands);
    } catch (error) {
      report(error);
      throw error;
    } finally {
      busy = false;
      render();
    }
  },
  () => !busy && !pending && role !== 'reader',
);
const officeTools = document.createElement('div');
officeTools.className = 'office-tools';
officeTools.innerHTML = `<div class="office-readout"><span id="office-held">NO FOLDER IN HAND</span><span id="office-keys">KEY RING · 0</span><span id="office-bank">CABINETS · 1/1</span></div>
<div class="actions" role="group" aria-label="Office interactions"><button data-action="office:hold">Pick up folder</button><button data-action="office:release">Put down</button><button data-action="office:dependencies" id="office-xray" aria-pressed="false">Dependencies / X-ray</button><button data-action="office:quick" id="office-quick" aria-pressed="false">Quick View</button><button data-action="office:unlock">Use key ring</button><button data-action="office:pin">Pin folder</button><button data-action="office:file-all">File all</button><button data-action="office-fullscreen">Full screen</button></div>
<div class="actions" role="group" aria-label="Look around office" style="margin-top:8px"><button data-action="look:left">← Look left</button><button data-action="look:desk">Desk</button><button data-action="look:files">Cabinets</button><button data-action="look:right">Look right →</button><button data-action="office:cabinets-previous">Previous bank</button><button data-action="office:cabinets-next">Next bank</button></div>
<p id="office-feedback" class="office-hint" role="status">Open a drawer. Pick up a folder. Follow its keys.</p>`;
$('#scene').after(officeTools);
officeTools
  .querySelector('.actions')!
  .insertAdjacentHTML(
    'afterbegin',
    '<button data-action="packet:open">Work packet / Print</button><button data-action="packet:read">Read in room</button><button data-action="cal:open-view" class="primary">Calendar</button><button data-action="board:open-view">Detective board</button>',
  );
officeTools
  .querySelector('[aria-label="Look around office"]')!
  .insertAdjacentHTML(
    'afterbegin',
    '<button data-action="look:calendar">Calendar on wall</button><button data-action="look:board">Board on wall</button>',
  );
officeTools.insertAdjacentHTML(
  'beforeend',
  `<details class="office-pages"><summary>Move around · WASD / sticks</summary><div class="actions" role="group" aria-label="Room movement"><button data-action="move:forward">↑ Forward</button><button data-action="move:left">← Step left</button><button data-action="move:back">↓ Backward</button><button data-action="move:right">Step right →</button><button data-action="move:turn-left">Turn left</button><button data-action="move:turn-right">Turn right</button><button data-action="move:desk">Back to desk</button><button data-action="move:toggle" id="movement-toggle" aria-pressed="${movement}">${movement ? 'Free move on' : 'Free move off'}</button></div><p class="office-hint">WASD moves · Q/E turns · right-drag looks. VR: left stick moves, right stick snap-turns. One controller: stick moves; use the wall's turn buttons.</p></details>`,
);
officeTools
  .querySelector('.actions')!
  .insertAdjacentHTML('beforeend', '<button data-action="office:back">Back to folder</button>');
officeTools.insertAdjacentHTML(
  'beforeend',
  '<details class="office-pages"><summary>More controls</summary><div class="actions"><button data-action="office:quick-previous">Previous related</button><span id="office-related-page">1/1</span><button data-action="office:quick-next">Next related</button><button data-action="office:keys-previous">Previous keys</button><span id="office-key-page">1/1</span><button data-action="office:keys-next">Next keys</button></div></details>',
);
officeTools.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
  if (
    !['office-fullscreen', 'board:open-view', 'cal:open-view'].includes(button.dataset.action ?? '')
  )
    button.disabled = true;
});
const cabinetIndex = document.createElement('details');
cabinetIndex.className = 'cabinet-index';
cabinetIndex.innerHTML =
  '<summary>Cabinet controls · keyboard & touch</summary><div class="cabinet-list" id="cabinet-list"></div>';
$('.stage').after(cabinetIndex);
function updateOfficeControls(feedback: OfficeFeedback) {
  officeTools.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    button.disabled = false;
  });
  if ($('#office-feedback').textContent !== feedback.message) cue();
  const file = filing?.files.find((file) => file.id === feedback.held);
  $('#office-held').textContent = file ? `HOLDING · ${file.label}` : 'NO FOLDER IN HAND';
  $('#office-keys').textContent = `KEY RING · ${feedback.keys}`;
  $('#office-bank').textContent = `CABINETS · ${feedback.cabinetPage}`;
  $('#office-related-page').textContent = feedback.relatedPage;
  $('#office-key-page').textContent = feedback.keyPage;
  $('#office-feedback').textContent = feedback.message;
  $('#office-xray').setAttribute('aria-pressed', String(feedback.xray));
  $('#office-quick').setAttribute('aria-pressed', String(feedback.quickView));
  $('#scene').dataset.held = feedback.held ?? '';
  $('#scene').dataset.xray = String(feedback.xray);
  $('#scene').dataset.quickView = String(feedback.quickView);
}

function showDialog(id: string) {
  lastFocus = document.activeElement as HTMLElement;
  const dialog = $<HTMLDialogElement>(`#${id}`);
  dialog.querySelectorAll<HTMLElement>('.form-error').forEach((el) => {
    el.hidden = true;
  });
  dialog.showModal();
}
document.querySelectorAll<HTMLDialogElement>('dialog').forEach((dialog) => {
  dialog.addEventListener('close', () => lastFocus?.focus());
});
function report(error: unknown) {
  failure = error instanceof Error ? error.message : String(error);
  $('#error').textContent = failure;
  $('#error').hidden = false;
  const formError = document.querySelector<HTMLElement>('dialog[open] .form-error');
  if (formError) {
    formError.textContent = failure;
    formError.hidden = false;
  }
  updateScene();
}
function say(text: string) {
  message = text;
  failure = '';
  $('#notice').textContent = text;
  $('#error').hidden = true;
  updateScene();
}
function selectedItem() {
  return state?.items.find((i) => i.id === selected);
}
function selectedNode() {
  const found = nodes.find((n) => n.id === selected);
  if (found || !state) return found;
  // An archived unfinished prerequisite can still block work. Keep it reachable.
  const item = selectedItem();
  if (!item?.archived) return undefined;
  const offset = queryItems(state, { archived: true }).findIndex((i) => i.id === selected);
  return observe(state, { id: '', role }, { archived: true }, offset, 1, worker.environment)
    .nodes[0];
}
function setSelection(id: string, stayInRoom = false) {
  if (!state?.items.some((i) => i.id === id)) return;
  scene?.inspect(id);
  selected = id;
  caseBoard.focus(id);
  detailPage = 0;
  relationPage = 0;
  render();
  if (!stayInRoom && !immersive && matchMedia('(max-width: 690px)').matches) {
    const heading = $('#inspector h2');
    heading?.setAttribute('tabindex', '-1');
    $('#inspector').scrollIntoView({ behavior: 'instant', block: 'start' });
    heading?.focus({ preventScroll: true });
  }
}
function stateBadge(node: SemanticNode) {
  const m = marks[stateMark(node)];
  return `<span class="state"><b style="color:${m.color}" aria-hidden="true">${m.symbol}</b>${m.label}</span>`;
}
function related(node: SemanticNode) {
  return node.relationships.filter((r) => r.kind === 'depends_on' && r.direction === 'outgoing');
}
function updateScene() {
  if (!scene || !state) return;
  const node = selectedNode(),
    item = selectedItem();
  if (packetTask !== item?.id) {
    packetTask = item?.id ?? '';
    packetStep = 0;
    packetPage = 0;
    packetHandoff = null;
  }
  const filtered = visibleNodes(nodes, filter, search);
  const legal = node?.actions.find((a) => a.id === 'complete' || a.id === 'reopen');
  const parts = item?.description.match(/[\s\S]{1,180}/g) ?? [];
  detailPage = Math.min(detailPage, Math.max(0, parts.length - 1));
  const actions: SpatialView['actions'] = [];
  if (item && node) {
    if (!['done', 'cancelled', 'active'].includes(item.status))
      actions.push({
        id: 'start',
        label: 'Start step',
        enabled: role !== 'reader' && stateMark(node) !== 'waiting',
      });
    if (legal)
      actions.push({
        id: legal.id === 'reopen' ? 'reopen' : 'complete',
        label: legal.id === 'reopen' ? 'Reopen' : 'Finish step',
        enabled: legal.enabled,
      });
    if (actions.length < 2 && parts.length > 1)
      actions.push({ id: 'read-more', label: 'More notes', enabled: true });
  }
  const links = node
    ? [...related(node), ...node.relationships.filter((r) => !related(node).includes(r))].map(
        (r) => ({
          id: r.targetId,
          label: `${r.kind === 'depends_on' ? (r.direction === 'outgoing' ? 'Needs' : 'Unlocks') : r.kind === 'contains' ? (r.direction === 'outgoing' ? 'Step' : 'Project') : 'Related'}: ${r.targetLabel}`,
        }),
      )
    : [];
  relationPage = Math.min(relationPage, Math.max(0, Math.ceil(links.length / 2) - 1));
  const context: SpatialView['context'] = [
    {
      id: 'read-more',
      label: `Notes ${detailPage + 1}/${Math.max(1, parts.length)}`,
      enabled: parts.length > 1,
    },
    {
      id: 'more-links',
      label: `Links ${relationPage + 1}/${Math.max(1, Math.ceil(links.length / 2))}`,
      enabled: links.length > 2,
    },
    { id: 'resource', label: 'Link ↗', enabled: !!item && !!resourceFor(item) },
    { id: 'edit', label: 'Edit ↗', enabled: !!item && role !== 'reader' },
  ];
  scene.update({
    board: caseBoard.view,
    calendar: calendar.view,
    packet: packetDeskView(
      state,
      item?.id ?? '',
      packetStep,
      packetPage,
      packetOpen,
      !busy && !pending && role !== 'reader',
      packetHandoff,
    ),
    movement,
    catalog: filing!,
    title: state.workspace.title,
    nodes: filtered.slice(page * 6, page * 6 + 6),
    selected: node,
    detail: `${item?.effortMinutes ? `${item.effortMinutes} min · ` : ''}${item?.dueDate ? `Due ${item.dueDate}\n` : ''}${parts[detailPage] ?? (node && stateMark(node) === 'waiting' ? 'Follow a prerequisite below.' : 'One small step at a time.')}`,
    links: links.slice(relationPage * 2, relationPage * 2 + 2),
    actions,
    context,
    pageLabel: `${page + 1} / ${Math.max(1, Math.ceil(filtered.length / 6))}`,
    previous: page > 0,
    next: (page + 1) * 6 < filtered.length,
    message: failure ? `Save issue: ${failure}` : message,
    busy,
    large,
    audio: sound,
  });
}
function render() {
  calendar.refreshAvailability();
  const previousFocus = document.activeElement as HTMLElement | null;
  const restoreFocus = previousFocus?.closest('#cards, #next-card, #inspector, #pages');
  const focusAction = previousFocus?.dataset.action;
  const has = Boolean(state);
  $('#intro').hidden = has;
  $('#work').hidden = !has;
  $('#space-title').textContent = state?.workspace.title ?? 'Make room to think.';
  $<HTMLButtonElement>('#add-work').disabled = !has || busy || role === 'reader' || !!pending;
  $('#retry').hidden = !pending;
  document.querySelectorAll<HTMLButtonElement>('form button[type=submit]').forEach((button) => {
    button.disabled = busy || !!pending || !client;
  });
  document.querySelectorAll<HTMLInputElement>('#setup-form input').forEach((input) => {
    input.disabled = !!setupPending;
  });
  $<HTMLButtonElement>('#setup-form button[type=submit]').textContent = setupPending
    ? 'Retry create'
    : 'Create space';
  const openDialog = document.querySelector('dialog[open]');
  document.querySelector('#dialog-retry')?.remove();
  if (pending && openDialog) {
    const retry = document.createElement('button');
    retry.id = 'dialog-retry';
    retry.type = 'button';
    retry.dataset.action = 'retry-save';
    retry.textContent = 'Retry the same save';
    retry.disabled = busy;
    openDialog.append(retry);
  }
  $<HTMLSelectElement>('#workspace').innerHTML =
    `<option value="">Choose a space</option>${spaces.map((s) => `<option value="${esc(s.id)}" ${s.id === workspaceId ? 'selected' : ''}>${esc(s.title)}</option>`).join('')}`;
  $<HTMLSelectElement>('#workspace').disabled = busy || !!pending;
  document
    .querySelectorAll<HTMLButtonElement>('[data-filter]')
    .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === filter)));
  $('#sound-toggle').textContent = $('#comfort-sound').textContent = sound
    ? 'Sound on'
    : 'Sound off';
  $('#sound-toggle').setAttribute('aria-pressed', String(sound));
  $('#comfort-sound').setAttribute('aria-pressed', String(sound));
  if (!state) return;
  $('#cabinet-list').innerHTML = (filing?.cabinets ?? [])
    .map(
      (cabinet) =>
        `<section class="cabinet-card"><h3>${esc(cabinet.label)}</h3><p>${cabinet.fileIds.length} folders · ${cabinet.missingKeys.length ? `${cabinet.missingKeys.length} missing keys` : 'keys ready'}</p><div class="actions">${[0, 1, 2].map((index) => `<button data-action="room:drawer:${esc(cabinet.id)}/${index}">Drawer ${index + 1}</button>`).join('')}${cabinet.requiredKeys.length ? `<button data-action="room:lock:${esc(cabinet.id)}">Unlock cabinet</button>` : ''}</div></section>`,
    )
    .join('');
  const filtered = visibleNodes(nodes, filter, search);
  page = Math.min(page, Math.max(0, Math.ceil(filtered.length / 6) - 1));
  $('#cards').innerHTML =
    filtered
      .slice(page * 6, page * 6 + 6)
      .map(
        (n) =>
          `<button class="card" data-action="select:${esc(n.id)}" aria-pressed="${n.id === selected}">${stateBadge(n)}<strong>${esc(n.label)}</strong><small>${esc(n.kind)}</small></button>`,
      )
      .join('') || '<p class="muted">No steps in this view. Try All work or add a step.</p>';
  $('#index-title').textContent =
    `${{ all: 'All work', ready: 'Ready', waiting: 'Needs first', done: 'Finished' }[filter]} · ${filtered.length}`;
  $('#pages').innerHTML =
    `<button data-action="previous" ${page === 0 ? 'disabled' : ''} aria-label="Previous page">←</button><span>${page + 1} / ${Math.max(1, Math.ceil(filtered.length / 6))}</span><button data-action="next" ${(page + 1) * 6 >= filtered.length ? 'disabled' : ''} aria-label="Next page">→</button>`;
  const next = calendar.next;
  const nextBlock = calendar.today?.suggestions.find((s) => s.id === next?.id);
  const finished = state.items.filter(
    (i) => i.kind === 'task' && ['done', 'cancelled'].includes(i.status),
  ).length;
  $('#next-card').innerHTML =
    `<p class="eyebrow">${next ? 'YOUR NEXT STEP' : 'A MOMENT TO RESET'}</p><h2>${esc(next?.title ?? (calendar.today?.capacityMinutes === 0 ? 'Today is clear.' : 'Nothing ready right now.'))}</h2><p class="muted">${next ? `${nextBlock ? `${nextBlock.estimated ? '≈ ' : ''}${nextBlock.minutes} min · ` : ''}${next.status === 'active' ? 'Pick up where you left off.' : 'Prerequisites are clear.'}` : 'Open today’s plan to adjust time or review requirements.'}</p>${next ? `<button class="primary" data-action="select:${esc(next.id)}">${next.status === 'active' ? 'Continue' : 'Show next'} →</button>` : '<button data-filter="waiting">◇ See prerequisites</button>'}${undo ? '<button data-action="undo" style="margin-top:10px">↶ Undo last status</button>' : ''}`;
  $('#next-card').insertAdjacentHTML(
    'beforeend',
    `<p class="muted">${calendar.today?.plannedMinutes ?? 0}m planned today · ${calendar.dailyMinutes / 60}h daily default</p><button data-action="cal:open-view">Today’s plan →</button>`,
  );
  $('#record-count').textContent =
    `${state.items.length} records · ${finished} finished tasks · Revision ${state.workspace.revision}`;
  const item = selectedItem(),
    node = selectedNode();
  if (!item || !node)
    $('#inspector').innerHTML =
      '<h2>Choose a step.</h2><p class="muted">Its requirements and actions appear here.</p>';
  else {
    const legal = node.actions.find((a) => ['complete', 'reopen'].includes(a.id));
    const blocked = stateMark(node) === 'waiting';
    const canWrite = !busy && !pending && role !== 'reader';
    const link = resourceFor(item);
    const prerequisites = related(node);
    const otherLinks = node.relationships.filter(
      (r) => !(r.kind === 'depends_on' && r.direction === 'outgoing'),
    );
    $('#inspector').innerHTML =
      `${stateBadge(node)}<h2 style="margin-top:12px">${esc(item.title)}</h2>${item.dueDate ? `<p class="muted">Due ${esc(item.dueDate)}</p>` : ''}${item.schedule ? `<p class="muted">${esc(new Date(item.schedule.start).toLocaleString())} · scheduled</p>` : ''}<div class="actions">${!['done', 'cancelled', 'active'].includes(item.status) ? `<button class="primary" data-action="start" ${!canWrite || blocked ? 'disabled' : ''}>Start</button>` : ''}${legal ? `<button data-action="${legal.id === 'reopen' ? 'reopen' : 'complete'}" ${!canWrite || !legal.enabled ? 'disabled' : ''}>${legal.id === 'reopen' ? 'Reopen' : 'Finish'}</button>` : ''}<button data-action="edit" ${!canWrite ? 'disabled' : ''}>Edit</button></div>${legal?.reason ? `<p class="muted" style="margin-top:12px">${esc(legal.reason)}</p>` : ''}${item.description ? `<h3>Small steps / notes</h3><p class="notes">${esc(item.description)}</p>` : ''}${link ? `<a id="resource-link" class="button" style="margin-top:16px;width:100%" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Open resource ↗</a><small>${esc(new URL(link).hostname)}</small>` : ''}<h3>Needs first</h3><div class="links">${prerequisites.map((r) => `<div><button data-action="select:${esc(r.targetId)}">◇ ${esc(r.targetLabel)}</button><button data-action="unlink:${esc(r.id)}" aria-label="Remove prerequisite: ${esc(r.targetLabel)}" ${!canWrite ? 'disabled' : ''}>Unlink</button></div>`).join('') || '<p class="muted">No prerequisites.</p>'}<button data-action="needs" ${!canWrite ? 'disabled' : ''}>＋ Add prerequisite</button></div>${otherLinks.length ? `<h3>Connected work</h3><div class="links">${otherLinks.map((r) => `<button data-action="select:${esc(r.targetId)}">${r.kind === 'contains' ? (r.direction === 'outgoing' ? '↳' : '↑') : '↔'} ${esc(r.targetLabel)}</button>`).join('')}</div>` : ''}`;
  }
  if (item) {
    const packet = latestPacket(state, item.id);
    const gaps = packet ? packetIssues(state, packet).length : 0;
    $('#inspector').insertAdjacentHTML(
      'afterbegin',
      `<div class="actions"><button class="primary" data-action="packet:open">${packet ? (gaps ? '◇ Review instructions' : '▶ Follow instructions') : 'Build instructions'} / Print</button></div>`,
    );
  }
  updateScene();
  if (restoreFocus && focusAction) {
    const replacement = document.querySelector<HTMLButtonElement>(
      `${restoreFocus.id ? `#${restoreFocus.id} ` : ''}[data-action="${CSS.escape(focusAction)}"]`,
    );
    if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
    else {
      const heading = $('#inspector h2');
      heading?.setAttribute('tabindex', '-1');
      heading?.focus({ preventScroll: true });
    }
  }
}

async function refresh(target = workspaceId) {
  const freshSpaces = await client.list();
  const fresh =
    target && freshSpaces.some((s) => s.id === target) ? await client.snapshot(target) : undefined;
  // This snapshot view has no authenticated actor identity. Do not inherit personal confirmations.
  const assets = fresh?.instructions?.assets?.length ? await client.assets(target) : [];
  if (target !== workspaceId) {
    selected = '';
    page = 0;
    undo = null;
  }
  spaces = freshSpaces;
  state = fresh;
  worker = {
    environment: {
      availableAssetIds: assets.filter((asset) => asset.available).map((asset) => asset.id),
    },
  };
  workspaceId = fresh?.workspace.id ?? '';
  remember('workspace', workspaceId);
  role = spaces.find((s) => s.id === workspaceId)?.role ?? 'reader';
  nodes = state ? semanticNodes(state, role, worker) : [];
  filing = state ? officeCatalog(state, role, worker) : undefined;
  if (state) {
    caseBoard.setWork(state);
    calendar.setWork(state, role, worker);
  } else {
    caseBoard.clear();
    calendar.clear();
  }
  if (!selected || !state?.items.some((n) => n.id === selected))
    selected = state
      ? (nextTask(state, new Date().toISOString(), worker)?.id ?? nodes[0]?.id ?? '')
      : '';
  render();
  if (state && !scene) await prepareScene();
  else if (scene) await checkVR();
}
async function checkVR() {
  if (!scene || immersive) return;
  const supported = await scene.supported().catch(() => false);
  $<HTMLButtonElement>('#enter-vr').disabled = !supported;
  $('#enter-vr').textContent = supported ? 'Enter VR' : 'VR unavailable';
  $('#xr-status').textContent = supported
    ? 'Headset available · seated or standing'
    : 'Desktop preview · all work buttons available below';
}
async function prepareScene() {
  try {
    const { SpatialScene } = await import('./scene');
    scene = new SpatialScene(
      $('#scene'),
      (action) => {
        if (action.startsWith('select:')) {
          if (action.slice(7) !== selected) setSelection(action.slice(7), true);
          else caseBoard.focus(action.slice(7));
        } else void act(action);
      },
      (active) => {
        immersive = active;
        $('#enter-vr').textContent = active ? 'Exit VR' : 'Enter VR';
      },
      report,
      updateOfficeControls,
    );
    $('#scene-loading').hidden = true;
    updateScene();
    await checkVR();
  } catch (e) {
    scene?.dispose();
    scene = undefined;
    $('#scene-loading').hidden = false;
    $('#scene-loading').textContent =
      '3D is unavailable here. All your work and actions are available below.';
    $('#enter-vr').textContent = 'Use work buttons';
    $('#xr-status').textContent = e instanceof Error ? e.message : 'Graphics unavailable';
  }
}
async function command(commands: Command[]) {
  if (!state) throw new Error('Choose a workspace first.');
  if (pending) throw new Error('The last save needs an exact retry. Use Retry save first.');
  pending = {
    workspace: state.workspace.id,
    request: {
      schemaVersion: 1,
      requestId: uid(),
      expectedRevision: state.workspace.revision,
      commands,
    },
  };
  await submitPending();
}
async function submitPending() {
  if (!pending) return;
  try {
    await client.execute(pending.workspace, pending.request);
  } catch (e) {
    if (e instanceof WorkError) {
      pending = null;
      if (e.code === 'CONFLICT') {
        await refresh();
        throw new Error(
          'Work changed in another view. Refreshed safely. Review the step and try again.',
        );
      }
    }
    throw e;
  }
  // Keep the exact receipt until the refreshed view arrives too. A lost read response
  // must not turn a successfully created item into a second new item on retry.
  await refresh();
  pending = null;
  say('Saved on this computer.');
  cue();
}
async function toggleSound() {
  if (sound) {
    sound = false;
    await audioContext?.suspend();
  } else {
    audioContext ??= new AudioContext();
    await audioContext.resume();
    sound = true;
    cue();
  }
  render();
}
function cue() {
  if (!sound || !audioContext || audioContext.state !== 'running') return;
  const oscillator = audioContext.createOscillator(),
    gain = audioContext.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.value = 660;
  gain.gain.setValueAtTime(0, audioContext.currentTime);
  gain.gain.linearRampToValueAtTime(0.035, audioContext.currentTime + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.1);
  oscillator.connect(gain);
  gain.connect(audioContext.destination);
  oscillator.start();
  oscillator.stop(audioContext.currentTime + 0.12);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
}
async function guarded(task: () => Promise<void>) {
  if (busy) return;
  busy = true;
  render();
  try {
    await task();
  } catch (e) {
    report(e);
  } finally {
    busy = false;
    render();
  }
}
function openEdit(item?: WorkItem) {
  const form = $<HTMLFormElement>('#edit-form');
  form.reset();
  const set = (name: string, value: string) => {
    (form.elements.namedItem(name) as HTMLInputElement).value = value;
  };
  set('itemId', item?.id ?? '');
  set('title', item?.title ?? '');
  set('kind', item?.kind ?? 'task');
  set('priority', String(item?.priority ?? 1));
  set('minutes', String(item?.effortMinutes ?? ''));
  set('dueDate', item?.dueDate ?? '');
  set('description', item?.description ?? '');
  set('resource', item ? (resourceFor(item) ?? '') : '');
  form.querySelector<HTMLSelectElement>('[name=parent]')!.innerHTML =
    '<option value="">No project</option>' +
    state!.items
      .filter((i) => i.kind === 'project' && !i.archived)
      .map((i) => `<option value="${esc(i.id)}">${esc(i.title)}</option>`)
      .join('');
  $('#parent-label').hidden = !!item;
  $('#edit-title').textContent = item ? 'Edit step' : 'Add a step';
  showDialog('edit-dialog');
}
async function act(action: string) {
  if (action.startsWith('packet:') && action !== 'packet:open') {
    const item = selectedItem();
    if (action === 'packet:read') {
      packetOpen = true;
      scene?.navigate('desk');
    }
    if (action === 'packet:close') packetOpen = false;
    if (state && item) {
      if (latestPacket(state, item.id)?.execution)
        packetHandoff = await client.handoff(workspaceId, item.id);
      const view = packetDeskView(
        state,
        item.id,
        packetStep,
        packetPage,
        true,
        !busy && !pending && role !== 'reader',
        packetHandoff,
      );
      if (action === 'packet:previous-page') packetPage = Math.max(0, view.page - 1);
      if (action === 'packet:next-page') packetPage = Math.min(view.pages - 1, view.page + 1);
      if (action === 'packet:previous-step') {
        packetStep = Math.max(0, view.step - 1);
        packetPage = 0;
      }
      if (action === 'packet:next-step') {
        packetStep = Math.min(view.steps - 1, view.step + 1);
        packetPage = 0;
      }
      if (
        action === 'packet:check' &&
        view.canCheck &&
        !view.checked &&
        view.packetId &&
        view.stepId
      ) {
        busy = true;
        try {
          await command([
            {
              type: 'packet.check',
              id: view.packetId,
              stepId: view.stepId,
              checked: true,
              evidence: '',
            },
          ]);
          if (latestPacket(state!, item.id)?.execution) {
            packetHandoff = await client.handoff(workspaceId, item.id);
            const next = packetHandoff.next[0];
            packetStep = next
              ? latestPacket(state!, item.id)!.steps.findIndex((s) => s.id === next.stepId)
              : view.step;
          } else packetStep = Math.min(view.steps - 1, view.step + 1);
          packetPage = 0;
        } finally {
          busy = false;
        }
      }
    }
    render();
    return;
  }
  if (action === 'packet:open') {
    if (immersive) await scene?.exit();
    const task = selectedItem() ?? calendar.next;
    location.assign(
      `/instructions/?workspace=${encodeURIComponent(workspaceId)}${task ? `&task=${encodeURIComponent(task.id)}${state && latestPacket(state, task.id)?.steps[packetStep] ? `&step=${encodeURIComponent(latestPacket(state, task.id)!.steps[packetStep]!.id)}` : ''}` : ''}`,
    );
    return;
  }
  if (action === 'board:open-view' && immersive) await scene?.exit();
  if (action === 'cal:open-view' && immersive) await scene?.exit();
  if (action.startsWith('cal:')) {
    await calendar.action(action);
    return;
  }
  if (caseBoard.action(action)) return;
  if (action === 'move:toggle') {
    movement = !movement;
    remember('movement', String(movement));
    $('#movement-toggle').setAttribute('aria-pressed', String(movement));
    $('#movement-toggle').textContent = movement ? 'Free move on' : 'Free move off';
    updateScene();
    return;
  }
  if (action.startsWith('move:')) {
    scene?.navigate(action.slice(5));
    return;
  }
  if (action === 'next-focus' && state) {
    const next = calendar.next;
    if (next) {
      setSelection(next.id, true);
      scene?.officeAction('office:hold');
    } else
      say(
        'Today’s plan is clear. Open the calendar to change available time or review requirements.',
      );
    return;
  }
  if (action.startsWith('office:') || action.startsWith('room:')) {
    scene?.officeAction(action.startsWith('room:') ? action.slice(5) : action);
    return;
  }
  if (action.startsWith('look:')) {
    scene?.look(action.slice(5) as 'left' | 'right' | 'desk' | 'files' | 'board' | 'calendar');
    return;
  }
  if (action === 'office-fullscreen') {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await $('.stage').requestFullscreen();
    } catch {
      say('Use your browser full-screen control to expand the office.');
    }
    return;
  }
  if (action === 'enter') {
    try {
      if (immersive) await scene?.exit();
      else await scene?.enter();
    } catch (e) {
      report(e);
    }
    return;
  }
  if (action === 'exit') {
    await scene?.exit();
    return;
  }
  if (action === 'recenter') {
    scene?.recenter();
    return;
  }
  if (action === 'audio') {
    try {
      await toggleSound();
    } catch {
      report('Audio is unavailable. Visual save messages remain available.');
    }
    return;
  }
  if (action === 'large') {
    large = !large;
    remember('large', String(large));
    $('#large-toggle').setAttribute('aria-pressed', String(large));
    updateScene();
    return;
  }
  if (action.startsWith('select:')) {
    setSelection(action.slice(7));
    return;
  }
  if (action === 'previous' || action === 'next') {
    page = Math.max(0, page + (action === 'next' ? 1 : -1));
    render();
    return;
  }
  if (action === 'read-more') {
    const parts = selectedItem()?.description.match(/[\s\S]{1,180}/g) ?? [];
    detailPage = (detailPage + 1) % Math.max(1, parts.length);
    updateScene();
    return;
  }
  if (action === 'more-links') {
    relationPage =
      (relationPage + 1) % Math.max(1, Math.ceil((selectedNode()?.relationships.length ?? 0) / 2));
    updateScene();
    return;
  }
  if (action === 'resource') {
    await scene?.exit();
    $('#resource-link')?.focus();
    say('Open resource is ready below the selected step.');
    return;
  }
  if (action === 'help' || action === 'comfort' || action === 'setup') {
    showDialog(`${action}-dialog`);
    return;
  }
  if (busy) return;
  if (action === 'add') {
    if (state) openEdit();
    return;
  }
  if (action === 'edit') {
    await scene?.exit();
    const item = selectedItem();
    if (item) openEdit(item);
    return;
  }
  if (action === 'needs') {
    const form = $<HTMLFormElement>('#needs-form');
    form.reset();
    form.querySelector<HTMLSelectElement>('[name=existing]')!.innerHTML =
      '<option value="">Create a new prerequisite</option>' +
      state!.items
        .filter((i) => i.id !== selected && !i.archived)
        .map((i) => `<option value="${esc(i.id)}">${esc(i.title)}</option>`)
        .join('');
    showDialog('needs-dialog');
    return;
  }
  await guarded(async () => {
    if (action === 'refresh') {
      await refresh();
      say('Up to date.');
    } else if (action === 'retry-save') {
      const created = pending?.request.commands.find((c) => c.type === 'item.create');
      await submitPending();
      if (created?.type === 'item.create') selected = created.item.id;
      document.querySelector<HTMLDialogElement>('dialog[open]')?.close();
    } else if (action === 'start' || action === 'complete' || action === 'reopen') {
      const item = selectedItem();
      if (!item) return;
      const prior = {
        workspace: workspaceId,
        itemId: item.id,
        status: item.status,
        version: item.version + 1,
      };
      await command([
        statusCommand(
          item,
          action === 'start' ? 'active' : action === 'complete' ? 'done' : 'ready',
        ),
      ]);
      undo = prior;
      say(
        action === 'complete'
          ? 'Step finished. Kept in your records.'
          : 'Saved. One step at a time.',
      );
    } else if (action === 'undo' && undo) {
      const item = state?.items.find((i) => i.id === undo!.itemId);
      if (!item || workspaceId !== undo.workspace || item.version !== undo.version)
        throw new Error(
          'This step changed since your action. Open it to review its current status.',
        );
      await command([statusCommand(item, undo.status)]);
      undo = null;
      say('Previous status restored. History kept.');
    } else if (action.startsWith('unlink:')) {
      await command([{ type: 'relation.remove', id: action.slice(7) }]);
    } else if (action === 'export' && state) {
      const snapshot = await client.export(workspaceId);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `statework-${workspaceId}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      say('Snapshot exported. Keep it somewhere private.');
    }
  });
}

document.addEventListener('click', (event) => {
  const target = (event.target as Element).closest<HTMLButtonElement>('button');
  if (!target || target.disabled) return;
  // Safari does not focus every button on mouse click. Remember a real dialog return target.
  target.focus({ preventScroll: true });
  if (target.hasAttribute('data-close')) {
    target.closest<HTMLDialogElement>('dialog')?.close();
    return;
  }
  if (target.dataset.action) {
    void act(target.dataset.action);
    return;
  }
  if (target.dataset.filter) {
    filter = target.dataset.filter as Filter;
    page = 0;
    render();
    return;
  }
  if (target.dataset.template) {
    const blank = target.dataset.template === 'blank';
    const form = $<HTMLFormElement>('#setup-form');
    for (let i = 0; i < 5; i++)
      (form.elements.namedItem(`step${i}`) as HTMLInputElement).value = blank
        ? ''
        : starterTasks[i]!;
    document
      .querySelectorAll('[data-template]')
      .forEach((el) => el.setAttribute('aria-pressed', String(el === target)));
  }
});
$('#find').addEventListener('input', (event) => {
  search = (event.target as HTMLInputElement).value;
  page = 0;
  render();
});
$('#workspace').addEventListener('change', () => {
  const target = $<HTMLSelectElement>('#workspace').value;
  void guarded(async () => {
    await refresh(target);
    remember('workspace', workspaceId);
  });
});
$('#flat-link').addEventListener('click', () => {
  if (workspaceId) {
    try {
      localStorage.setItem('statework.workspace', workspaceId);
    } catch {
      /* optional */
    }
  }
});

$('#setup-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.target as HTMLFormElement);
  void guarded(async () => {
    if (!setupPending) {
      const id = uid(),
        title = String(data.get('workspaceName')).trim();
      const snapshot = starterSnapshot(
        {
          id,
          title,
          project: String(data.get('projectName')),
          tasks: Array.from({ length: 5 }, (_, i) => String(data.get(`step${i}`)).trim()).filter(
            Boolean,
          ),
        },
        new Date().toISOString(),
      );
      setupPending = { snapshot, target: { id, title } };
    }
    const setup = setupPending;
    // Import has no receipt. An uncertain response is recovered using its unique workspace ID.
    const existing = await client.list();
    if (!existing.some((s) => s.id === setup.target.id)) {
      try {
        await client.import(setup.snapshot, setup.target);
      } catch (error) {
        if (error instanceof WorkError) setupPending = null;
        throw error;
      }
    }
    await refresh(setup.target.id);
    setupPending = null;
    remember('workspace', workspaceId);
    $<HTMLDialogElement>('#setup-dialog').close();
    say('Your space is ready. Select a step to begin.');
  });
});
$('#edit-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.target as HTMLFormElement);
  void guarded(async () => {
    const id = String(data.get('itemId')) || uid(),
      existing = state!.items.find((i) => i.id === id);
    const rawLink = String(data.get('resource')).trim(),
      link = rawLink ? safeResource(rawLink) : null;
    if (rawLink && !link)
      throw new Error('Use a full http or https link without embedded credentials.');
    const extensions = { ...existing?.extensions };
    if (link) extensions[resourceNamespace] = { url: link };
    else delete extensions[resourceNamespace];
    const fields = {
      title: String(data.get('title')).trim(),
      kind: String(data.get('kind')) as WorkItem['kind'],
      priority: Number(data.get('priority')) as WorkItem['priority'],
      effortMinutes: data.get('minutes') === '' ? null : Number(data.get('minutes')),
      dueDate: String(data.get('dueDate')) || null,
      description: String(data.get('description')),
      extensions,
    };
    const commands: Command[] = existing
      ? [{ type: 'item.update', id, expectedVersion: existing.version, patch: fields }]
      : [{ type: 'item.create', item: { id, ...fields, status: 'ready' } }];
    if (!existing && data.get('parent'))
      commands.push({
        type: 'relation.add',
        relation: { id: uid(), kind: 'contains', from: String(data.get('parent')), to: id },
      });
    await command(commands);
    selected = id;
    $<HTMLDialogElement>('#edit-dialog').close();
    render();
  });
});
$('#needs-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const data = new FormData(event.target as HTMLFormElement);
  void guarded(async () => {
    const existing = String(data.get('existing'));
    const id = existing || uid();
    const rawLink = String(data.get('resource')).trim(),
      link = rawLink ? safeResource(rawLink) : null;
    if (!existing && rawLink && !link)
      throw new Error('Use a full http or https link without embedded credentials.');
    const commands: Command[] = [];
    if (!existing) {
      const title = String(data.get('title')).trim();
      if (!title) throw new Error('Name the prerequisite or select an existing step.');
      commands.push({
        type: 'item.create',
        item: {
          id,
          title,
          kind: 'task',
          status: 'ready',
          priority: 2,
          extensions: link ? { [resourceNamespace]: { url: link } } : {},
        },
      });
    }
    commands.push({
      type: 'relation.add',
      relation: { id: uid(), kind: 'depends_on', from: selected, to: id },
    });
    await command(commands);
    $<HTMLDialogElement>('#needs-dialog').close();
    render();
  });
});

async function connect() {
  const response = await fetch('/local/session', {
    method: 'POST',
    headers: { 'X-StateWork-Local': '1' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      'Could not connect to StateWork. Start the local server, then reload this page.',
    );
  const session = await response.json();
  client = new WorkClient(location.origin, session.token);
  await refresh();
}
window.addEventListener('pagehide', () => {
  scene?.dispose();
  void audioContext?.close();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) location.reload();
});
navigator.xr?.addEventListener('devicechange', () => {
  void checkVR();
});
void connect().catch(report);
