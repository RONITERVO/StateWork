import { isFinished, observe } from '@statework/sdk';
import type { Role, SemanticNode, WorkState } from '@statework/sdk';

export interface OfficeFile {
  id: string;
  label: string;
  cabinetId: string;
  kind: SemanticNode['kind'];
  node: SemanticNode;
  requiredKeys: string[];
  missingKeys: string[];
  archived: boolean;
}
export interface OfficeCabinet {
  id: string;
  label: string;
  fileIds: string[];
  requiredKeys: string[];
  missingKeys: string[];
}
export interface OfficeKey {
  id: string;
  label: string;
  unlocks: string[];
  waived: boolean;
}
export interface OfficeCatalog {
  workspaceId: string;
  files: OfficeFile[];
  cabinets: OfficeCabinet[];
  keys: OfficeKey[];
}
export const inboxCabinet = 'office:inbox';
export const cabinetCapacity = 12;

/** The filing metaphor is derived from the complete graph, never from a filtered page. */
export function officeCatalog(state: WorkState, role: Role): OfficeCatalog {
  const semantic = new Map<string, SemanticNode>();
  for (const archived of [false, true]) {
    let offset = 0;
    do {
      const result = observe(
        state,
        { id: 'office-view', role },
        { archived, sort: 'title' },
        offset,
        500,
      );
      result.nodes.forEach((node) => semantic.set(node.id, node));
      if (result.nextOffset === null) break;
      offset = result.nextOffset;
    } while (offset < state.items.length);
  }
  const byId = new Map(state.items.map((item) => [item.id, item]));
  const parent = new Map(
    state.relations.filter((r) => r.kind === 'contains').map((r) => [r.to, r.from]),
  );
  const requirements = new Map<string, string[]>(),
    dependents = new Map<string, string[]>();
  for (const edge of state.relations.filter((r) => r.kind === 'depends_on')) {
    requirements.set(edge.from, [...(requirements.get(edge.from) ?? []), edge.to]);
    dependents.set(edge.to, [...(dependents.get(edge.to) ?? []), edge.from]);
  }
  const lock = (id: string) => ({
    requiredKeys: [...(requirements.get(id) ?? [])].sort(),
    missingKeys: (requirements.get(id) ?? []).filter((key) => !isFinished(byId.get(key)!)).sort(),
  });
  const cabinetFor = (id: string) => {
    let ancestor = parent.get(id);
    const seen = new Set<string>();
    while (ancestor && !seen.has(ancestor)) {
      seen.add(ancestor);
      if (byId.get(ancestor)?.kind === 'project') return ancestor;
      ancestor = parent.get(ancestor);
    }
    return inboxCabinet;
  };
  const cabinets: OfficeCabinet[] = state.items
    .filter((item) => item.kind === 'project')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((item) => ({ id: item.id, label: item.title, fileIds: [], ...lock(item.id) }));
  cabinets.push({
    id: inboxCabinet,
    label: 'Unfiled / inbox',
    fileIds: [],
    requiredKeys: [],
    missingKeys: [],
  });
  const files: OfficeFile[] = [...state.items]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((item) => ({
      id: item.id,
      label: item.title,
      cabinetId: cabinetFor(item.id),
      kind: item.kind,
      node: semantic.get(item.id)!,
      archived: item.archived,
      ...lock(item.id),
    }));
  for (const file of files) cabinets.find((c) => c.id === file.cabinetId)!.fileIds.push(file.id);
  return {
    workspaceId: state.workspace.id,
    files,
    cabinets,
    keys: state.items
      .filter((item) => dependents.has(item.id) && isFinished(item))
      .map((item) => ({
        id: item.id,
        label: item.title,
        unlocks: [...dependents.get(item.id)!].sort(),
        waived: item.status === 'cancelled',
      })),
  };
}

export interface DependencyTrace {
  ids: string[];
  edges: { from: string; to: string }[];
  missing: string[];
}
/** Every transitive prerequisite, plus direct dependents, with cycle protection. */
export function traceDependencies(catalog: OfficeCatalog, fileId: string): DependencyTrace {
  const byId = new Map(catalog.files.map((file) => [file.id, file]));
  const ids = new Set<string>(),
    edges: DependencyTrace['edges'] = [];
  const pending = [fileId];
  while (pending.length) {
    const id = pending.pop()!;
    if (ids.has(id) || !byId.has(id)) continue;
    ids.add(id);
    for (const key of byId.get(id)!.requiredKeys) {
      edges.push({ from: id, to: key });
      pending.push(key);
    }
  }
  for (const file of catalog.files)
    if (file.requiredKeys.includes(fileId)) {
      ids.add(file.id);
      if (!edges.some((e) => e.from === file.id && e.to === fileId))
        edges.push({ from: file.id, to: fileId });
    }
  const earned = new Set(catalog.keys.map((key) => key.id));
  return {
    ids: [...ids],
    edges,
    missing: [...new Set(edges.map((edge) => edge.to))].filter((id) => !earned.has(id)),
  };
}

export type OfficeHand = 'desktop' | 'left' | 'right';
export interface OfficeSession {
  workspaceId: string;
  held: { id: string; hand: OfficeHand } | null;
  xray: boolean;
  quickView: boolean;
  quickPage: number;
  relatedCapacity: number;
  keyPage: number;
  cabinetPage: number;
  cabinetSheets: Record<string, number>;
  drawers: Record<string, boolean>;
  unlatched: string[];
  pinned: string[];
  inspected: string | null;
  message: string;
}
export function newOfficeSession(workspaceId: string): OfficeSession {
  return {
    workspaceId,
    held: null,
    xray: false,
    quickView: false,
    quickPage: 0,
    relatedCapacity: 5,
    keyPage: 0,
    cabinetPage: 0,
    cabinetSheets: {},
    drawers: {},
    unlatched: [],
    pinned: [],
    inspected: null,
    message: 'Open a drawer. Pick up a folder.',
  };
}
export type OfficeIntent =
  | { type: 'hold'; id: string; hand: OfficeHand }
  | { type: 'release' }
  | { type: 'inspect'; id: string }
  | { type: 'dependencies' }
  | { type: 'quick-view' }
  | { type: 'quick-page'; delta: number }
  | { type: 'key-page'; delta: number }
  | { type: 'cabinet-page'; delta: number }
  | { type: 'cabinet-sheet'; id: string; delta: number }
  | { type: 'drawer'; cabinetId: string; index: number }
  | { type: 'unlock'; id: string }
  | { type: 'pin' }
  | { type: 'file-all' };

export function isSealed(
  session: OfficeSession,
  target: Pick<OfficeFile, 'id' | 'requiredKeys' | 'missingKeys'>,
): boolean {
  return (
    target.requiredKeys.length > 0 &&
    (target.missingKeys.length > 0 || !session.unlatched.includes(target.id))
  );
}
export function reconcileOffice(session: OfficeSession, catalog: OfficeCatalog): OfficeSession {
  if (session.workspaceId !== catalog.workspaceId) return newOfficeSession(catalog.workspaceId);
  const ids = new Set(catalog.files.map((file) => file.id));
  return {
    ...session,
    held: session.held && ids.has(session.held.id) ? session.held : null,
    inspected: session.inspected && ids.has(session.inspected) ? session.inspected : null,
    pinned: session.pinned.filter((id) => ids.has(id)),
    keyPage: Math.min(session.keyPage, Math.max(0, Math.ceil(catalog.keys.length / 6) - 1)),
    quickPage: Math.min(
      session.quickPage,
      Math.max(
        0,
        Math.ceil(
          (traceDependencies(catalog, session.held?.id ?? session.inspected ?? '').ids.length - 1) /
            session.relatedCapacity,
        ) - 1,
      ),
    ),
    cabinetSheets: Object.fromEntries(
      catalog.cabinets.map((c) => [
        c.id,
        Math.min(
          session.cabinetSheets[c.id] ?? 0,
          Math.max(0, Math.ceil(c.fileIds.length / cabinetCapacity) - 1),
        ),
      ]),
    ),
    drawers: Object.fromEntries(
      Object.entries(session.drawers).filter(([id]) => {
        const cabinet = catalog.cabinets.find((c) => c.id === id.slice(0, id.lastIndexOf('/')));
        return cabinet && !isSealed(session, cabinet);
      }),
    ),
    unlatched: session.unlatched.filter((id) => {
      const target =
        catalog.files.find((file) => file.id === id) ?? catalog.cabinets.find((c) => c.id === id);
      return !!target && target.missingKeys.length === 0;
    }),
    cabinetPage: Math.min(
      session.cabinetPage,
      Math.max(0, Math.ceil(catalog.cabinets.length / 3) - 1),
    ),
  };
}

/** Only presentation changes. Holding a key or stamping a mesh never writes task status. */
export function officeTransition(
  previous: OfficeSession,
  catalog: OfficeCatalog,
  intent: OfficeIntent,
): OfficeSession {
  const session = structuredClone(reconcileOffice(previous, catalog));
  const current = () => session.held?.id ?? session.inspected;
  switch (intent.type) {
    case 'hold': {
      const file = catalog.files.find((f) => f.id === intent.id);
      if (!file) return session;
      session.held = { id: file.id, hand: intent.hand };
      session.inspected = file.id;
      session.quickPage = 0;
      session.message = `Holding ${file.label}. Dependencies reveals its keys.`;
      break;
    }
    case 'release':
      session.held = null;
      session.message = 'Folder placed on the desk. File all returns it home.';
      break;
    case 'inspect':
      if (catalog.files.some((f) => f.id === intent.id)) {
        session.inspected = intent.id;
        session.quickPage = 0;
      }
      break;
    case 'dependencies':
      if (!current()) {
        session.message = 'Pick up or select a folder first.';
        break;
      }
      session.xray = !session.xray;
      session.quickPage = 0;
      session.message = session.xray
        ? 'X-ray on. Amber paths need keys; green paths are resolved.'
        : 'X-ray off.';
      break;
    case 'quick-view':
      if (!current()) {
        session.message = 'Pick up or select a folder first.';
        break;
      }
      session.quickView = !session.quickView;
      session.quickPage = 0;
      session.message = session.quickView
        ? 'Related folders brought within reach.'
        : 'Folders returned to their files.';
      break;
    case 'quick-page': {
      const trace = current()
        ? traceDependencies(catalog, current()!).ids.filter((id) => id !== current())
        : [];
      session.quickPage = Math.max(
        0,
        Math.min(
          Math.ceil(trace.length / session.relatedCapacity) - 1,
          session.quickPage + intent.delta,
        ),
      );
      break;
    }
    case 'key-page':
      session.keyPage = Math.max(
        0,
        Math.min(Math.ceil(catalog.keys.length / 6) - 1, session.keyPage + intent.delta),
      );
      break;
    case 'cabinet-page':
      session.cabinetPage = Math.max(
        0,
        Math.min(Math.ceil(catalog.cabinets.length / 3) - 1, session.cabinetPage + intent.delta),
      );
      break;
    case 'cabinet-sheet': {
      const c = catalog.cabinets.find((c) => c.id === intent.id);
      if (!c) break;
      session.cabinetSheets[c.id] = Math.max(
        0,
        Math.min(
          Math.ceil(c.fileIds.length / cabinetCapacity) - 1,
          (session.cabinetSheets[c.id] ?? 0) + intent.delta,
        ),
      );
      break;
    }
    case 'drawer': {
      const cabinet = catalog.cabinets.find((c) => c.id === intent.cabinetId);
      if (!cabinet || intent.index < 0 || intent.index > 2) break;
      if (isSealed(session, cabinet)) {
        session.message = cabinet.missingKeys.length
          ? `Cabinet needs ${cabinet.missingKeys.length} key(s). Use Dependencies to find them.`
          : 'Your keys fit. Select the cabinet lock to unlock it.';
        break;
      }
      const id = `${cabinet.id}/${intent.index}`;
      session.drawers[id] = !session.drawers[id];
      session.message = session.drawers[id]
        ? 'Drawer open. Select a folder to pick it up.'
        : 'Drawer closed.';
      break;
    }
    case 'unlock': {
      const file =
        catalog.files.find((f) => f.id === intent.id) ??
        catalog.cabinets.find((c) => c.id === intent.id);
      if (!file) break;
      if (file.missingKeys.length) {
        session.xray = true;
        session.inspected = file.id;
        session.message = `Still needs ${file.missingKeys.length} key(s). Finish the highlighted prerequisites.`;
      } else {
        if (!session.unlatched.includes(file.id)) session.unlatched.push(file.id);
        session.message = `${file.label} unlocked. Your prerequisite keys fit.`;
      }
      break;
    }
    case 'pin':
      if (current() && !session.pinned.includes(current()!)) {
        session.pinned.push(current()!);
        session.pinned = session.pinned.slice(-4);
        session.message = 'Pinned beside your desk.';
      }
      break;
    case 'file-all':
      session.held = null;
      session.pinned = [];
      session.xray = false;
      session.quickView = false;
      session.drawers = {};
      session.message = 'Everything filed. Work and history are unchanged.';
      break;
  }
  return session;
}
