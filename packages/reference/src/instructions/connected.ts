import { packetIssues, stepPredecessors } from '@statework/sdk';
import type {
  PacketInput,
  WorkPacket,
  WorkState,
  WorkerHandoff,
  WorkAsset,
  AssetInput,
  SourceInput,
  WorkConnection,
} from '@statework/sdk';

export const escape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const field = (name: string, label: string, value: string) =>
  `<label>${escape(label)}<input name="${name}" value="${escape(value)}" maxlength="12000"></label>`;
const option = (id: string, label: string, selected: boolean) =>
  `<option value="${escape(id)}" ${selected ? 'selected' : ''}>${escape(label)}</option>`;
const marks = { ready: '▶', blocked: '◇', waiting: '○', checked: '✓', skipped: '↷' };

export function connectedEditor(
  state: WorkState,
  draft: PacketInput,
  index: number,
  pending: { assets: AssetInput[]; sources: SourceInput[] } = { assets: [], sources: [] },
): string {
  if (!draft.execution)
    return '<fieldset><legend>Connected work</legend><p>Use files, parallel steps, decisions and separate worker readiness.</p><button type="button" data-action="enable-execution">Enable connected work</button></fieldset>';
  const step = draft.steps[index];
  const fileChoices = [
    ...(state.instructions?.assets ?? []).filter((a) => !a.archive),
    ...pending.assets,
  ];
  const archivedReference = (id: string | null) =>
    state.instructions?.assets?.find((a) => a.id === id && a.archive);
  const sourceChoices = [...(state.instructions?.sources ?? []), ...pending.sources];
  const unavailableChoice = (
    reference: NonNullable<PacketInput['steps'][number]['references']>[number],
  ) => {
    const assetId =
      reference.kind === 'source'
        ? sourceChoices.find((source) => source.id === reference.targetId)?.assetId
        : reference.kind === 'asset'
          ? reference.targetId
          : undefined;
    const archived = assetId ? archivedReference(assetId) : undefined;
    return archived
      ? `<option value="${escape(reference.kind)}/${escape(reference.targetId)}" selected disabled>Archived: ${escape(archived.name)} — restore in Files</option>`
      : '';
  };
  return `<fieldset id="execution-coverage"><legend>Coverage review</legend>${(['inputs', 'procedure', 'acceptance'] as const).map((key) => `<label><input type="checkbox" name="coverage-${key}" ${draft.execution!.coverage[key] === 'checked' ? 'checked' : ''}>I checked the ${key} requirements.</label>`).join('')}${field('coverage-note', 'What did you inspect? What are its limits?', draft.execution.coverage.note)}<h3>Successful finish</h3><p>At least one selected action must be checked. A stop or request for help is not a successful finish.</p>${draft.steps.map((s) => `<label><input type="checkbox" name="successful-finish" value="${escape(s.id)}" ${draft.execution!.completion.anyOf.includes(s.id) ? 'checked' : ''}>${escape(s.title)}</label>`).join('')}</fieldset>${
    step
      ? `<fieldset id="execution-step"><legend>Order and references</legend><label>Stage<select name="phase">${['prepare', 'work', 'verify', 'deliver'].map((p) => option(p, p, (step.phase ?? 'work') === p)).join('')}</select></label><details><summary>Needs these earlier results</summary><p>No selection means this action can run independently.</p>${draft.steps
          .filter((s) => s.id !== step.id)
          .map(
            (s) =>
              `<label><input type="checkbox" name="after" value="${escape(s.id)}" ${stepPredecessors(draft, step).includes(s.id) ? 'checked' : ''}>${escape(s.title)}</label>`,
          )
          .join(
            '',
          )}</details><label>Run this branch<select name="when"><option value="">Always</option>${draft.steps
          .filter((s) => s.id !== step.id && s.decision)
          .flatMap((s) =>
            s.decision!.options.map((o) =>
              option(
                `${s.id}/${o.id}`,
                `${s.title} → ${o.label}`,
                step.when?.stepId === s.id && step.when.optionId === o.id,
              ),
            ),
          )
          .join(
            '',
          )}</select></label><label><input type="checkbox" name="evidence-required" ${step.evidenceRequired ? 'checked' : ''}>Require a written result record</label>${step.decision ? `${field('decision-prompt', 'Decision to observe', step.decision.prompt)}${step.decision.options.map((o, i) => field(`option-${i}`, `Choice ${i + 1}`, o.label)).join('')}<button type="button" data-action="decision-add-option">＋ Choice</button><button type="button" data-action="decision-remove">Remove decision</button>` : '<button type="button" data-action="decision-add">＋ Decision</button>'}<h3>Direct references</h3>${(
          step.references ?? []
        )
          .map(
            (r, i) =>
              `<fieldset data-reference="${i}">${field('ref-label', 'Button label', r.label)}<label>Content<select name="ref-target">${unavailableChoice(r)}${option('external', 'External destination', r.kind === 'external')}${fileChoices.map((a) => option(`asset/${a.id}`, `File: ${a.name}`, r.kind === 'asset' && r.targetId === a.id)).join('')}${sourceChoices
                .filter((s) => !s.assetId || !archivedReference(s.assetId))
                .filter((s) => draft.sourceIds.includes(s.id))
                .map((s) =>
                  option(
                    `source/${s.id}`,
                    `Capture: ${s.title}`,
                    r.kind === 'source' && r.targetId === s.id,
                  ),
                )
                .join(
                  '',
                )}</select></label>${field('ref-url', 'External URL (if needed)', r.url)}${field('ref-location', 'Exact section / view / drawing', r.location)}<div class="packet-fields">${field('ref-page', 'Page (optional)', r.page === null ? '' : String(r.page))}${field('ref-seconds', 'Video seconds (optional)', r.seconds === null ? '' : String(r.seconds))}</div><label>Purpose<select name="ref-purpose">${['input', 'instruction', 'example'].map((p) => option(p, p, r.purpose === p)).join('')}</select></label><label><input type="checkbox" name="ref-essential" ${r.essential ? 'checked' : ''}>Required to perform this action</label><button type="button" data-action="reference-remove:${i}">Remove reference</button></fieldset>`,
          )
          .join(
            '',
          )}<button type="button" data-action="reference-add">＋ Reference</button><h3>Output files</h3>${draft.execution.outputs
          .filter((o) => o.stepId === step.id)
          .map(
            (o) =>
              `<fieldset data-output="${escape(o.id)}">${field('output-label', 'Output name', o.label)}${field('output-description', 'File format, contents and acceptance check', o.description)}<label><input type="checkbox" name="output-required" ${o.required ? 'checked' : ''}>Required to check this result</label><button type="button" data-action="output-remove:${escape(o.id)}">Remove output</button></fieldset>`,
          )
          .join(
            '',
          )}<button type="button" data-action="output-add">＋ Output file</button></fieldset>`
      : ''
  }`;
}
export function collectConnected(draft: PacketInput, index: number, root: HTMLElement): void {
  if (!draft.execution || !root.querySelector('#execution-coverage')) return;
  const value = (name: string, within: Element = root) =>
    within.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)?.value ?? '';
  const checked = (name: string, within: Element = root) =>
    within.querySelector<HTMLInputElement>(`[name="${name}"]`)?.checked ?? false;
  for (const key of ['inputs', 'procedure', 'acceptance'] as const)
    draft.execution.coverage[key] = checked(`coverage-${key}`) ? 'checked' : 'unknown';
  draft.execution.coverage.note = value('coverage-note');
  draft.execution.completion.anyOf = [
    ...root.querySelectorAll<HTMLInputElement>('[name="successful-finish"]:checked'),
  ].map((e) => e.value);
  const step = draft.steps[index];
  if (!step) return;
  step.phase = value('phase') as NonNullable<typeof step.phase>;
  step.after = [...root.querySelectorAll<HTMLInputElement>('[name="after"]:checked')].map(
    (e) => e.value,
  );
  const [stepId, optionId] = value('when').split('/');
  if (stepId && optionId) step.when = { stepId, optionId };
  else delete step.when;
  step.evidenceRequired = checked('evidence-required');
  if (step.decision) {
    step.decision.prompt = value('decision-prompt');
    step.decision.options.forEach((o, i) => {
      o.label = value(`option-${i}`);
    });
  }
  root.querySelectorAll<HTMLElement>('[data-reference]').forEach((el) => {
    const r = step.references![Number(el.dataset.reference)]!;
    const [kind, targetId] = value('ref-target', el).split('/');
    Object.assign(r, {
      label: value('ref-label', el),
      kind,
      targetId: targetId ?? null,
      url: value('ref-url', el),
      location: value('ref-location', el),
      page: value('ref-page', el) === '' ? null : Number(value('ref-page', el)),
      seconds: value('ref-seconds', el) === '' ? null : Number(value('ref-seconds', el)),
      essential: checked('ref-essential', el),
      purpose: value('ref-purpose', el),
    });
  });
  root.querySelectorAll<HTMLElement>('[data-output]').forEach((el) => {
    const o = draft.execution!.outputs.find((o) => o.id === el.dataset.output)!;
    o.label = value('output-label', el);
    o.description = value('output-description', el);
    o.required = checked('output-required', el);
  });
}
export function renderWorkMap(
  draft: PacketInput,
  handoff: WorkerHandoff | null,
  selected: number,
): string {
  const levels = new Map<string, number>(),
    visiting = new Set<string>();
  const level = (id: string): number => {
    if (levels.has(id)) return levels.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const step = draft.steps.find((s) => s.id === id);
    const parents = step ? stepPredecessors(draft, step).filter((p) => p !== id) : [];
    const n = parents.length ? 1 + Math.max(...parents.map(level)) : 0;
    visiting.delete(id);
    levels.set(id, n);
    return n;
  };
  draft.steps.forEach((s) => level(s.id));
  const columns = Math.max(0, ...levels.values()) + 1;
  return `<h2>The work map</h2>${handoff?.completion.outcome === 'stopped' ? '<div class="compact-blocker"><strong>◇ Stopped — outcome not reached</strong><p>Resolve the missing prerequisite, then undo and revisit the relevant decision.</p></div>' : ''}<p class="map-legend">▶ Ready · ◇ Blocked · ○ Waiting · ✓ Checked · ↷ Skipped</p><div class="work-map-scroll"><div class="work-map" style="grid-template-columns:repeat(${columns}, minmax(150px, 1fr))">${Array.from(
    { length: columns },
    (_, c) =>
      `<div class="map-column">${draft.steps
        .map((s, i) => ({ s, i }))
        .filter(({ s }) => levels.get(s.id) === c)
        .map(({ s, i }) => {
          const row = handoff?.graph.find((r) => r.id === s.id),
            status = row?.status ?? 'blocked';
          return `<button class="map-node map-${status}" data-action="step:${i}" ${i === selected ? 'aria-current="step"' : ''}><span class="map-shape">${marks[status]}</span><strong>${escape(s.title)}</strong><small>${escape(s.phase ?? 'work')} · ${status}</small>${
            stepPredecessors(draft, s).length
              ? `<span class="map-parents">← ${stepPredecessors(draft, s)
                  .map((id) => escape(draft.steps.find((s) => s.id === id)?.title ?? id))
                  .join(' + ')}</span>`
              : ''
          }${s.when ? `<small>When: ${escape(draft.steps.find((p) => p.id === s.when!.stepId)?.decision?.options.find((o) => o.id === s.when!.optionId)?.label ?? 'decision')}</small>` : ''}</button>`;
        })
        .join('')}</div>`,
  ).join(
    '',
  )}</div></div><button data-action="copy-handoff">Copy agent handoff</button> <button data-action="download-handoff">↓ Handoff</button>`;
}
export function drawMapConnections(root: HTMLElement, draft: PacketInput): void {
  const map = root.querySelector<HTMLElement>('.work-map');
  if (!map) return;
  map.querySelector('svg')?.remove();
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('map-connections');
  svg.setAttribute('width', String(map.scrollWidth));
  svg.setAttribute('height', String(map.scrollHeight));
  const box = map.getBoundingClientRect();
  draft.steps.forEach((step, index) => {
    const target = map
      .querySelector<HTMLElement>(`[data-action="step:${index}"]`)
      ?.getBoundingClientRect();
    if (!target) return;
    for (const parentId of stepPredecessors(draft, step)) {
      const parentIndex = draft.steps.findIndex((s) => s.id === parentId);
      const parent = map
        .querySelector<HTMLElement>(`[data-action="step:${parentIndex}"]`)
        ?.getBoundingClientRect();
      if (!parent) continue;
      const x1 = parent.right - box.left,
        y1 = parent.top + parent.height / 2 - box.top;
      const x2 = target.left - box.left,
        y2 = target.top + target.height / 2 - box.top;
      const path = document.createElementNS(svg.namespaceURI, 'path');
      path.setAttribute(
        'd',
        `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`,
      );
      path.setAttribute('data-from', parentId);
      path.setAttribute('data-to', step.id);
      svg.append(path);
    }
  });
  map.prepend(svg);
}
export function connectedFollow(
  state: WorkState,
  draft: PacketInput,
  packet: WorkPacket | null,
  handoff: WorkerHandoff | null,
  index: number,
  dirty: boolean,
  reader: boolean,
): string {
  const step = draft.steps[index];
  if (!step) return '<h2>Add an action.</h2>';
  const row = handoff?.graph.find((r) => r.id === step.id),
    status = dirty ? 'blocked' : (row?.status ?? 'blocked');
  const checked = status === 'checked';
  const issues = packetIssues(state, dirty ? draft : (packet ?? draft));
  return `<p class="eyebrow">${escape(step.phase ?? 'work')} · ${marks[status]} ${status}</p><h2>${escape(step.title)}</h2>${issues.length ? `<div class="compact-blocker"><strong>◇ Instructions needed</strong><p>${escape(issues[0]!.label)}</p><button data-action="${issues[0]!.code === 'source' || issues[0]!.code === 'citation' ? 'sources' : 'edit'}">Resolve</button><button data-action="questions">See gaps</button></div>` : ''}${
    row?.blockers
      .filter((b) => b.code !== 'instructions')
      .map(
        (b) =>
          `<div class="compact-blocker"><strong>◇ ${escape(b.label)}</strong><p>${escape(b.action)}</p>${b.code === 'requirement' ? `<button data-action="confirm-requirement:${escape(b.target)}" ${reader ? 'disabled' : ''}>Check requirement</button>` : `<button data-action="${b.code === 'file' ? 'files' : b.code === 'order' ? 'map' : 'worker-access'}">${b.code === 'access' ? 'Set access' : 'Open'}</button>`}</div>`,
      )
      .join('') ?? ''
  }<p class="current-instruction">${escape(step.instruction)}</p><div class="reference-buttons">${(step.references ?? []).map((r) => `<button data-action="open-reference:${escape(r.id)}">${r.kind === 'asset' ? '▧' : r.kind === 'source' ? '▤' : '↗'} ${escape(r.label)}${r.page ? ` · p${r.page}` : r.seconds !== null ? ` · ${r.seconds}s` : ''}</button>`).join('')}</div>${step.actionUrl ? `<button data-action="open-action-url">Open task ↗</button>` : ''}<div class="packet-check"><h3>✓ Check</h3><p>${escape(step.expected)}</p>${step.decision ? `<p>${escape(step.decision.prompt)}</p><fieldset class="decision-choices"><legend>Observed result</legend>${step.decision.options.map((o) => `<label><input type="radio" name="result-choice" value="${escape(o.id)}">${escape(o.label)}</label>`).join('')}</fieldset>` : ''}${draft
    .execution!.outputs.filter((o) => o.stepId === step.id)
    .map(
      (o) =>
        `<label>${escape(o.label)}${o.required ? ' (required)' : ''}<select data-result-output="${escape(o.id)}"><option value="">Choose attached result file</option>${(
          handoff?.assets ?? []
        )
          .filter((a) => !a.archive && a.available && a.taskIds.includes(draft.taskId))
          .map((a) => option(a.id, a.name, false))
          .join('')}</select></label><button data-action="files">Attach result</button>`,
    )
    .join(
      '',
    )}<label>Result record${step.evidenceRequired ? ' (required)' : ' (optional)'}<input id="check-evidence" maxlength="12000" placeholder="Measurement, receipt or observation"></label><button class="primary" data-action="check" ${!reader && !dirty && (status === 'ready' || checked) ? '' : 'disabled'}>${checked ? '↶ Undo result' : '✓ Result matches'}</button></div><details><summary>◇ If stuck</summary><p>${escape(step.ifBlocked)}</p><button data-action="question-for-step" ${reader ? 'disabled' : ''}>Record a gap</button></details><div class="packet-stepnav"><button data-action="map">← Map</button><button data-action="next-ready">Next ready →</button></div>`;
}
export function renderFiles(
  assets: (WorkAsset & { available: boolean })[],
  reader: boolean,
  storage?: ReturnType<WorkConnection['storageInfo']>,
  taskId?: string,
): string {
  const mib = (bytes: number) =>
    (bytes / 1024 / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 });
  const large =
    storage &&
    (storage.storedBytes > storage.inlineBundle.totalBytes ||
      storage.largestFileBytes > storage.inlineBundle.fileBytes);
  const usage = storage
    ? `<p class="file-storage-summary">▧ ${mib(storage.storedBytes)} / ${mib(storage.limits.workspaceBytes)} MiB · ${storage.storedFiles} unique files</p><meter aria-label="Workspace file storage" min="0" max="${storage.limits.workspaceBytes}" value="${Math.min(storage.storedBytes, storage.limits.workspaceBytes)}"></meter>`
    : '';
  const packageHelp = `<details ${large ? 'open' : ''}><summary>Folder export${large ? ' required' : ''}</summary><p>Keep every original in a portable folder. Run the export command from the StateWork folder with the same STATEWORK_HOME data directory used to start the server.</p><button data-action="copy-package-command">Copy export command</button></details>`;
  const row = (a: WorkAsset & { available: boolean }) =>
    `<li><strong>${a.available ? '▧' : '◇'} ${escape(a.name)}</strong><p>${escape(a.description)} · ${mib(a.size)} MiB</p><p>${a.available ? 'Stored locally' : 'Original bytes missing'}</p>${a.available ? `<button data-action="download-asset:${escape(a.id)}">Open / download</button>${!a.archive ? `<button data-action="use-asset:${escape(a.id)}" ${reader ? 'disabled' : ''}>Use in this step</button>` : ''}` : `<label>Restore exact file<input type="file" data-restore-asset="${escape(a.id)}" ${reader ? 'disabled' : ''}></label>`}<button data-action="${a.archive ? 'unarchive' : 'archive'}-asset:${escape(a.id)}" ${reader ? 'disabled' : ''}>${a.archive ? 'Restore to active' : 'Archive'}</button>${a.archive ? `<p>${escape(a.archive.reason)}</p>` : ''}<details><summary>Identity and source</summary><p>${escape(a.locator)}</p><code>${escape(a.sha256)}</code><p>${escape(a.capturedAt)} · ${escape(a.capturedBy)}</p></details></li>`;
  const active = assets.filter((a) => !a.archive);
  const direct = active.filter((a) => !taskId || a.taskIds.includes(taskId));
  const shared = active.filter((a) => taskId && !a.taskIds.includes(taskId));
  const archived = assets.filter((a) => a.archive);
  const list = (files: (WorkAsset & { available: boolean })[]) =>
    `<ul class="packet-source-list">${files.map(row).join('')}</ul>`;
  return `<h2>Files within reach</h2>${usage}<div class="packet-toolbar"><button data-action="export-work-bundle" ${large ? 'disabled' : ''}>↓ Workspace + files</button><label>Restore into new workspace<input id="import-work-bundle" type="file" accept=".json" ${reader ? 'disabled' : ''}></label></div>${packageHelp}<p>Full-quality originals, stored once.</p>${direct.length ? list(direct) : '<p>No files attached directly to this task.</p>'}${shared.length ? `<details><summary>Shared files · ${shared.length}</summary>${list(shared)}</details>` : ''}${archived.length ? `<details><summary>Archived · ${archived.length}</summary><p>Original bytes and history are preserved. Archiving does not free storage.</p>${list(archived)}</details>` : ''}<details><summary>Attach a file</summary><form id="asset-form" class="packet-form"><label>Choose original file<input type="file" id="asset-file" ${reader ? 'disabled' : ''}></label>${field('asset-description', 'What does this file provide?', '')}${field('asset-locator', 'Source / original location', '')}<button data-action="upload-asset" ${reader ? 'disabled' : ''}>Attach file</button></form></details>`;
}
