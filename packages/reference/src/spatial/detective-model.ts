import type { WorkItem, WorkState } from '@statework/sdk';

export type CaseMark = 'ready' | 'active' | 'waiting' | 'done' | 'cancelled';
export const caseMarks: Record<
  CaseMark,
  { color: string; ink: string; symbol: string; label: string }
> = {
  ready: { color: '#bde7d2', ink: '#164a39', symbol: '○', label: 'Ready' },
  active: { color: '#acdced', ink: '#16485b', symbol: '▶', label: 'In progress' },
  waiting: { color: '#efc18d', ink: '#693719', symbol: '◇', label: 'Needs first' },
  done: { color: '#ced8bf', ink: '#394931', symbol: '✓', label: 'Done' },
  cancelled: { color: '#dad3cd', ink: '#51483f', symbol: '–', label: 'Cancelled' },
};
export interface CaseRecord {
  item: WorkItem;
  mark: CaseMark;
  parent: string | null;
  project: string;
  needs: string[];
  missing: string[];
  unlocks: string[];
  children: string[];
  related: string[];
}
export interface CaseLink {
  id: string;
  /** Prerequisite → work; parent → child. Related links have no direction. */
  from: string;
  to: string;
  kind: 'depends_on' | 'contains' | 'relates_to';
}
export interface CaseGraph {
  workspaceId: string;
  title: string;
  revision: number;
  records: Map<string, CaseRecord>;
  links: CaseLink[];
  ordered: string[];
}
const finished = (record: CaseRecord) => ['done', 'cancelled'].includes(record.item.status);
const order = (a: string, b: string) => a.localeCompare(b);

/** One index over the entire authorized snapshot. A screen filter is never an input. */
export function caseGraph(state: WorkState): CaseGraph {
  const records = new Map<string, CaseRecord>();
  for (const item of state.items)
    records.set(item.id, {
      item,
      mark: item.status === 'inbox' ? 'ready' : item.status,
      parent: null,
      project: '',
      needs: [],
      missing: [],
      unlocks: [],
      children: [],
      related: [],
    });
  const links: CaseLink[] = [];
  for (const relation of state.relations) {
    const from = records.get(relation.from),
      to = records.get(relation.to);
    if (!from || !to) continue;
    if (relation.kind === 'depends_on') {
      from.needs.push(relation.to);
      to.unlocks.push(relation.from);
      links.push({ id: relation.id, kind: relation.kind, from: relation.to, to: relation.from });
    } else {
      links.push({ ...relation });
      if (relation.kind === 'contains') {
        to.parent = relation.from;
        from.children.push(relation.to);
      } else {
        from.related.push(relation.to);
        to.related.push(relation.from);
      }
    }
  }
  for (const [id, record] of records) {
    record.needs.sort(order);
    record.unlocks.sort(order);
    record.children.sort(order);
    record.related.sort(order);
    record.missing = record.needs.filter((key) => !finished(records.get(key)!));
    if (!finished(record) && record.missing.length) record.mark = 'waiting';
    let parent: string | null = id;
    const seen = new Set<string>();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const candidate = records.get(parent);
      if (!candidate) break;
      if (candidate.item.kind === 'project') {
        record.project = parent;
        break;
      }
      parent = candidate.parent;
    }
  }
  return {
    workspaceId: state.workspace.id,
    title: state.workspace.title,
    revision: state.workspace.revision,
    records,
    links,
    ordered: [...records.keys()].sort(order),
  };
}

export type CaseLens = 'overview' | 'requirements' | 'impact' | 'unblock';
export type CaseFilter = 'all' | 'open' | 'finished' | 'archived';
export interface CaseScope {
  ids: string[];
  label: string;
}
export interface CaseSession {
  workspaceId: string;
  lens: CaseLens;
  filter: CaseFilter;
  focus: string | null;
  pins: string[];
  trail: string[];
  scope: CaseScope | null;
  back: CaseScope[];
  query: string;
  showContext: boolean;
}
export function newCaseSession(workspaceId: string): CaseSession {
  return {
    workspaceId,
    lens: 'overview',
    filter: 'all',
    focus: null,
    pins: [],
    trail: [],
    scope: null,
    back: [],
    query: '',
    showContext: true,
  };
}
export function restoreCaseSession(graph: CaseGraph, raw: unknown): CaseSession {
  const fresh = newCaseSession(graph.workspaceId);
  if (!raw || typeof raw !== 'object') return fresh;
  const saved = raw as Partial<CaseSession>;
  if (saved.workspaceId !== graph.workspaceId) return fresh;
  const ids = (value: unknown, max: number) =>
    Array.isArray(value)
      ? [
          ...new Set(
            value.filter((id): id is string => typeof id === 'string' && graph.records.has(id)),
          ),
        ].slice(-max)
      : [];
  const scope = (value: unknown): CaseScope | null => {
    if (!value || typeof value !== 'object') return null;
    const candidate = value as Partial<CaseScope>,
      members = ids(candidate.ids, 10000);
    return members.length && typeof candidate.label === 'string'
      ? { ids: members, label: candidate.label.slice(0, 240) }
      : null;
  };
  const focus =
    typeof saved.focus === 'string' && graph.records.has(saved.focus) ? saved.focus : null;
  return {
    ...fresh,
    lens:
      !focus && (saved.lens === 'requirements' || saved.lens === 'impact')
        ? 'overview'
        : ['overview', 'requirements', 'impact', 'unblock'].includes(saved.lens ?? '')
          ? saved.lens!
          : 'overview',
    filter: ['all', 'open', 'finished', 'archived'].includes(saved.filter ?? '')
      ? saved.filter!
      : 'all',
    focus,
    pins: ids(saved.pins, 12),
    trail: ids(saved.trail, 16),
    scope: scope(saved.scope),
    back: Array.isArray(saved.back)
      ? saved.back
          .slice(-8)
          .map(scope)
          .filter((s): s is CaseScope => !!s)
      : [],
    // Search is intentionally cleared on reload so remembered work is not hidden.
    showContext: saved.showContext === true,
  };
}

/** Iterative graph walk: long chains cannot exhaust the JavaScript call stack. */
export function caseReach(
  graph: CaseGraph,
  start: string,
  direction: 'needs' | 'unlocks',
): Set<string> {
  const seen = new Set<string>(),
    pending = [start];
  while (pending.length) {
    const id = pending.pop()!;
    if (seen.has(id) || !graph.records.has(id)) continue;
    seen.add(id);
    pending.push(...graph.records.get(id)![direction]);
  }
  return seen;
}
export interface CaseLead {
  id: string;
  opens: number;
  reaches: number;
  projects: number;
  archived: boolean;
}
/** Exact downstream reach via DAG bitsets; bounded to ~12.5 MB at 10,000 records. */
export function caseLeads(graph: CaseGraph, now: string): CaseLead[] {
  const { ordered, records } = graph,
    n = ordered.length;
  const index = new Map(ordered.map((id, i) => [id, i]));
  const remaining = new Uint32Array(n),
    queue: number[] = [],
    topo: number[] = [];
  ordered.forEach((id, i) => {
    remaining[i] = records.get(id)!.needs.length;
    if (!remaining[i]) queue.push(i);
  });
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!;
    topo.push(i);
    for (const child of records.get(ordered[i]!)!.unlocks) {
      const j = index.get(child)!;
      remaining[j] = remaining[j]! - 1;
      if (remaining[j] === 0) queue.push(j);
    }
  }
  // Imported valid StateWork graphs are acyclic. Guard partial/foreign indexes too.
  if (topo.length !== n) return [];
  const words = Math.ceil(n / 32),
    reach = new Uint32Array(n * words);
  for (let t = topo.length - 1; t >= 0; t--) {
    const i = topo[t]!,
      offset = i * words;
    for (const child of records.get(ordered[i]!)!.unlocks) {
      const j = index.get(child)!,
        childOffset = j * words;
      if (!finished(records.get(child)!)) reach[offset + (j >>> 5)]! |= 1 << (j & 31);
      for (let w = 0; w < words; w++) reach[offset + w]! |= reach[childOffset + w]!;
    }
  }
  const leads: CaseLead[] = [];
  ordered.forEach((id, i) => {
    const record = records.get(id)!;
    if (
      finished(record) ||
      record.missing.length ||
      (record.item.schedule && record.item.schedule.start > now)
    )
      return;
    const opens = record.unlocks.filter((child) => {
      const r = records.get(child)!;
      return !finished(r) && r.missing.length === 1;
    }).length;
    const projects = new Set<string>();
    let reaches = 0;
    for (let w = 0; w < words; w++) {
      let bits = reach[i * words + w]!;
      while (bits) {
        const bit = 31 - Math.clz32(bits & -bits),
          j = w * 32 + bit;
        reaches++;
        projects.add(records.get(ordered[j]!)!.project);
        bits &= bits - 1;
      }
    }
    if (reaches)
      leads.push({ id, opens, reaches, projects: projects.size, archived: record.item.archived });
  });
  return leads.sort(
    (a, b) =>
      Number(a.archived) - Number(b.archived) ||
      b.opens - a.opens ||
      b.reaches - a.reaches ||
      records.get(b.id)!.item.priority - records.get(a.id)!.item.priority ||
      order(a.id, b.id),
  );
}

export interface CaseCounts {
  total: number;
  ready: number;
  active: number;
  waiting: number;
  done: number;
  cancelled: number;
  archived: number;
}
export function caseCounts(graph: CaseGraph, ids: Iterable<string>): CaseCounts {
  const count: CaseCounts = {
    total: 0,
    ready: 0,
    active: 0,
    waiting: 0,
    done: 0,
    cancelled: 0,
    archived: 0,
  };
  for (const id of ids) {
    const record = graph.records.get(id);
    if (record) {
      count.total++;
      count[record.mark]++;
      if (record.item.archived) count.archived++;
    }
  }
  return count;
}
export interface CaseCard {
  id: string;
  label: string;
  ids: string[];
  recordId: string | null;
  counts: CaseCounts;
  x: number;
  y: number;
  width: number;
  height: number;
  selected: boolean;
  pinned: boolean;
  internalLinks: number;
  lead?: CaseLead;
}
export interface CaseThread {
  from: string;
  to: string;
  kind: CaseLink['kind'];
  count: number;
  missing: number;
  selected: boolean;
}
export interface CaseBoard {
  workspaceId: string;
  revision: number;
  title: string;
  subtitle: string;
  width: number;
  height: number;
  cards: CaseCard[];
  threads: CaseThread[];
  counts: CaseCounts;
  workspaceCounts: CaseCounts;
  allLinks: number;
  shownLinks: number;
  outsideLinks: number;
  leads: CaseLead[];
  focus: CaseRecord | null;
  requirements: number;
  impact: number;
}

function groupsFor(
  graph: CaseGraph,
  ids: string[],
  session: CaseSession,
): { id: string; label: string; ids: string[] }[] {
  const limit = 32;
  if (ids.length <= limit && (session.scope || session.lens !== 'overview' || ids.length <= 12))
    return ids.map((id) => ({
      id: `file:${id}`,
      label: graph.records.get(id)!.item.title,
      ids: [id],
    }));
  if (session.lens === 'unblock') {
    const size = Math.ceil(ids.length / limit);
    return Array.from({ length: Math.ceil(ids.length / size) }, (_, index) => {
      const members = ids.slice(index * size, (index + 1) * size);
      return {
        id: `leads:${members[0]}`,
        label: `Leads ${index * size + 1}–${index * size + members.length}`,
        ids: members,
      };
    });
  }
  const projects = new Map<string, string[]>();
  for (const id of ids) {
    const project = graph.records.get(id)!.project;
    const members = projects.get(project) ?? [];
    members.push(id);
    projects.set(project, members);
  }
  let groups = [...projects]
    .sort(([a], [b]) => order(a, b))
    .map(([id, members]) => ({
      id: `project:${id}`,
      label: graph.records.get(id)?.item.title ?? 'Unfiled work',
      ids: members,
    }));
  if (groups.length === 1 && ids.length > 1) groups = [];
  if (!groups.length || groups.length > limit) {
    // Consecutive groups share project membership/order; every ID still appears once.
    const members = groups.length ? groups.flatMap((g) => g.ids) : ids;
    const size = Math.ceil(members.length / limit);
    groups = [];
    for (let start = 0; start < members.length; start += size) {
      const chunk = members.slice(start, start + size),
        first = graph.records.get(chunk[0]!)!;
      groups.push({
        id: `bundle:${chunk[0]}`,
        label: chunk.length === 1 ? first.item.title : `${first.item.title} + ${chunk.length - 1}`,
        ids: chunk,
      });
    }
  }
  return groups;
}

/** Every matching record belongs to exactly one card, including dense aggregates. */
export function projectCase(graph: CaseGraph, session: CaseSession, leads: CaseLead[]): CaseBoard {
  let ids = session.scope
    ? session.scope.ids.filter((id) => graph.records.has(id))
    : [...graph.ordered];
  const focus = session.focus ? (graph.records.get(session.focus) ?? null) : null;
  if (focus && (session.lens === 'requirements' || session.lens === 'impact')) {
    const reach = caseReach(
      graph,
      focus.item.id,
      session.lens === 'requirements' ? 'needs' : 'unlocks',
    );
    ids = graph.ordered.filter((id) => reach.has(id));
  } else if (session.lens === 'unblock') {
    const wanted = new Set(ids);
    ids = leads.filter((lead) => wanted.has(lead.id)).map((lead) => lead.id);
  }
  const terms = session.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  ids = ids.filter((id) => {
    const r = graph.records.get(id)!;
    const matches =
      session.filter === 'all' ||
      (session.filter === 'open' && !finished(r)) ||
      (session.filter === 'finished' && finished(r)) ||
      (session.filter === 'archived' && r.item.archived);
    return (
      matches &&
      terms.every((term) =>
        `${r.item.title} ${r.item.tags.join(' ')} ${r.item.description}`
          .toLocaleLowerCase()
          .includes(term),
      )
    );
  });
  const groups = groupsFor(graph, ids, session),
    membership = new Map<string, string>();
  const cards: CaseCard[] = groups.map((group) => {
    group.ids.forEach((id) => membership.set(id, group.id));
    return {
      ...group,
      recordId: group.ids.length === 1 ? group.ids[0]! : null,
      counts: caseCounts(graph, group.ids),
      x: 0,
      y: 0,
      width: 218,
      height: 120,
      selected: !!session.focus && group.ids.includes(session.focus),
      pinned: group.ids.some((id) => session.pins.includes(id)),
      internalLinks: 0,
      lead:
        session.lens === 'unblock' && group.ids.length === 1
          ? leads.find((lead) => lead.id === group.ids[0])
          : undefined,
    };
  });
  const byId = new Map(cards.map((card) => [card.id, card])),
    threads = new Map<string, CaseThread>();
  let outsideLinks = 0,
    shownLinks = 0;
  for (const link of graph.links) {
    if (!session.showContext && link.kind !== 'depends_on') continue;
    const from = membership.get(link.from),
      to = membership.get(link.to);
    if (!from || !to) {
      if (from || to) outsideLinks++;
      continue;
    }
    shownLinks++;
    if (from === to) {
      byId.get(from)!.internalLinks++;
      continue;
    }
    const key = JSON.stringify([link.kind, from, to]);
    const thread = threads.get(key) ?? {
      from,
      to,
      kind: link.kind,
      count: 0,
      missing: 0,
      selected: false,
    };
    thread.count++;
    if (link.kind === 'depends_on' && !finished(graph.records.get(link.from)!)) thread.missing++;
    if (link.from === session.focus || link.to === session.focus) thread.selected = true;
    threads.set(key, thread);
  }
  // Stable shelves reserve each card's place; status changes never rearrange the case.
  const columns = Math.max(1, Math.min(6, Math.ceil(Math.sqrt(cards.length))));
  cards.forEach((card, i) => {
    card.x = 46 + (i % columns) * 266;
    card.y = 58 + Math.floor(i / columns) * 178;
  });
  const title =
    session.lens === 'requirements'
      ? 'Needs first'
      : session.lens === 'impact'
        ? 'What follows'
        : session.lens === 'unblock'
          ? 'Open the most doors'
          : (session.scope?.label ?? 'The whole case');
  const requirements = focus ? caseReach(graph, focus.item.id, 'needs').size - 1 : 0;
  const impact = focus ? caseReach(graph, focus.item.id, 'unlocks').size - 1 : 0;
  return {
    workspaceId: graph.workspaceId,
    revision: graph.revision,
    title,
    subtitle: `${ids.length} / ${graph.records.size} records · ${cards.length} cards · ${shownLinks} threads`,
    width: Math.max(600, columns * 266 + 44),
    height: Math.max(360, Math.ceil(cards.length / columns) * 178 + 45),
    cards,
    threads: [...threads.values()],
    counts: caseCounts(graph, ids),
    workspaceCounts: caseCounts(graph, graph.ordered),
    allLinks: graph.links.length,
    shownLinks,
    outsideLinks,
    leads,
    focus,
    requirements,
    impact,
  };
}

export type CaseIntent =
  | { type: 'overview' }
  | { type: 'back' }
  | { type: 'open'; card: CaseCard }
  | { type: 'focus'; id: string }
  | { type: 'lens'; lens: CaseLens }
  | { type: 'filter'; filter: CaseFilter }
  | { type: 'query'; query: string }
  | { type: 'pin'; id: string }
  | { type: 'context' };
export function caseTransition(
  graph: CaseGraph,
  previous: CaseSession,
  intent: CaseIntent,
): CaseSession {
  const session = structuredClone(previous);
  const focus = (id: string) => {
    if (!graph.records.has(id)) return;
    if (session.focus && session.focus !== id)
      session.trail = [
        ...session.trail.filter((old) => old !== session.focus),
        session.focus,
      ].slice(-16);
    session.focus = id;
  };
  switch (intent.type) {
    case 'overview':
      session.scope = null;
      session.back = [];
      session.lens = 'overview';
      session.filter = 'all';
      session.query = '';
      break;
    case 'back':
      if (session.back.length) session.scope = session.back.pop()!;
      else if (session.scope) session.scope = null;
      else if (session.trail.length) session.focus = session.trail.pop()!;
      session.lens = 'overview';
      session.query = '';
      break;
    case 'open':
      if (intent.card.recordId) focus(intent.card.recordId);
      else {
        if (session.scope) session.back = [...session.back, session.scope].slice(-8);
        session.scope = { ids: [...intent.card.ids], label: intent.card.label };
        if (session.lens !== 'unblock') session.lens = 'overview';
        session.query = '';
      }
      break;
    case 'focus':
      focus(intent.id);
      break;
    case 'lens':
      session.lens = intent.lens;
      session.scope = null;
      session.back = [];
      session.query = '';
      break;
    case 'filter':
      session.filter = intent.filter;
      break;
    case 'query':
      session.query = intent.query.slice(0, 240);
      break;
    case 'pin':
      if (session.pins.includes(intent.id))
        session.pins = session.pins.filter((id) => id !== intent.id);
      else if (graph.records.has(intent.id) && session.pins.length < 12)
        session.pins.push(intent.id);
      break;
    case 'context':
      session.showContext = !session.showContext;
      break;
  }
  return session;
}
