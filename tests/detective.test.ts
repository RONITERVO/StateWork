import { describe, expect, it } from 'vitest';
import type { WorkItem, WorkState } from '@statework/sdk';
import { caseCurve } from '../packages/reference/src/spatial/detective-drawing';
import {
  caseGraph,
  caseLeads,
  caseReach,
  caseTransition,
  newCaseSession,
  projectCase,
  restoreCaseSession,
} from '../packages/reference/src/spatial/detective-model';

const now = '2026-09-09T09:00:00.000Z';
function fixture(
  inputs: (Pick<WorkItem, 'id'> & Partial<WorkItem>)[],
  links: WorkState['relations'] = [],
): WorkState {
  return {
    schemaVersion: 1,
    workspace: { id: 'case', title: 'Fictional case', revision: 7, createdAt: now },
    views: [],
    relations: links,
    items: inputs.map((input) => ({
      title: input.id,
      kind: 'task',
      description: '',
      status: 'ready',
      priority: 1,
      tags: [],
      effortMinutes: null,
      dueDate: null,
      schedule: null,
      extensions: {},
      archived: false,
      version: 1,
      createdAt: now,
      updatedAt: now,
      ...input,
    })),
  };
}
const needs = (from: string, to: string) => ({
  id: `${from}-${to}`,
  from,
  to,
  kind: 'depends_on' as const,
});
describe('detective board evidence', () => {
  it('routes every pair through gutters without crossing an unrelated card', () => {
    const graph = caseGraph(fixture(Array.from({ length: 32 }, (_, i) => ({ id: `file-${i}` }))));
    const session = newCaseSession('case');
    session.scope = { ids: graph.ordered, label: 'All files' };
    const board = projectCase(graph, session, []);
    for (const from of board.cards)
      for (const to of board.cards) {
        if (from === to) continue;
        const points = caseCurve(from, to).points;
        for (let i = 1; i < points.length; i++) {
          const a = points[i - 1]!,
            b = points[i]!;
          expect(a.x === b.x || a.y === b.y).toBe(true);
          for (const card of board.cards) {
            if (card === from || card === to) continue;
            const crosses =
              a.x === b.x
                ? a.x > card.x &&
                  a.x < card.x + card.width &&
                  Math.max(a.y, b.y) > card.y &&
                  Math.min(a.y, b.y) < card.y + card.height
                : a.y > card.y &&
                  a.y < card.y + card.height &&
                  Math.max(a.x, b.x) > card.x &&
                  Math.min(a.x, b.x) < card.x + card.width;
            expect(crosses).toBe(false);
          }
        }
      }
  });
  it('restores a removed investigation to overview and ranks actionable cards by exact impact', () => {
    const graph = caseGraph(
      fixture(
        [{ id: 'a' }, { id: 'z' }, { id: 'b' }, { id: 'c' }],
        [needs('b', 'z'), needs('c', 'z')],
      ),
    );
    const session = restoreCaseSession(graph, {
      workspaceId: 'case',
      focus: 'gone',
      lens: 'impact',
    });
    expect(session.lens).toBe('overview');
    session.lens = 'unblock';
    const board = projectCase(graph, session, caseLeads(graph, now));
    expect(board.cards[0]?.recordId).toBe('z');
    expect(board.cards[0]?.lead).toMatchObject({ opens: 2, reaches: 2 });
    const inputs = Array.from({ length: 70 }, (_, i) => [
      { id: `lead-${i}`, priority: i === 69 ? 3 : 1 },
      { id: `result-${i}` },
    ]).flat();
    const dense = caseGraph(
      fixture(
        inputs,
        Array.from({ length: 70 }, (_, i) => needs(`result-${i}`, `lead-${i}`)),
      ),
    );
    const ranked = caseLeads(dense, now);
    const overview = { ...newCaseSession('case'), lens: 'unblock' as const };
    const grouped = projectCase(dense, overview, ranked);
    expect(grouped.cards[0]?.ids[0]).toBe('lead-69');
    const opened = caseTransition(dense, overview, { type: 'open', card: grouped.cards[0]! });
    expect(opened.lens).toBe('unblock');
    expect(projectCase(dense, opened, ranked).cards[0]?.recordId).toBe('lead-69');
  });
  it('uses the complete graph, preserves input and draws requirements toward their consumers', () => {
    const source = fixture(
      [
        { id: 'root', kind: 'project' },
        { id: 'access', archived: true },
        { id: 'build' },
        { id: 'old', status: 'done' },
      ],
      [needs('build', 'access'), { id: 'inside', from: 'root', to: 'build', kind: 'contains' }],
    );
    const before = structuredClone(source),
      graph = caseGraph(source),
      board = projectCase(graph, newCaseSession('case'), []);
    expect(source).toEqual(before);
    expect(graph.links).toContainEqual({
      id: 'build-access',
      from: 'access',
      to: 'build',
      kind: 'depends_on',
    });
    expect(graph.records.get('build')?.mark).toBe('waiting');
    expect(board.counts).toMatchObject({ total: 4, done: 1, archived: 1, waiting: 1 });
    expect(board.cards.flatMap((card) => card.ids).sort()).toEqual([
      'access',
      'build',
      'old',
      'root',
    ]);
  });
  it('counts shared downstream branches once and distinguishes opens-now from broader impact', () => {
    const graph = caseGraph(
      fixture(
        ['access', 'left', 'right', 'review', 'approval'].map((id) => ({ id })),
        [
          needs('left', 'access'),
          needs('right', 'access'),
          needs('review', 'left'),
          needs('review', 'right'),
          needs('review', 'approval'),
        ],
      ),
    );
    expect(caseLeads(graph, now)).toEqual([
      { id: 'access', opens: 2, reaches: 3, projects: 1, archived: false },
      { id: 'approval', opens: 0, reaches: 1, projects: 1, archived: false },
    ]);
    expect([...caseReach(graph, 'review', 'needs')].sort()).toEqual([
      'access',
      'approval',
      'left',
      'review',
      'right',
    ]);
    graph.records.get('access')!.item.status = 'done';
    const reopened = caseGraph(
      fixture(
        [...graph.records.values()].map((r) => r.item),
        [...graph.links].map((l) => ({ ...l, from: l.to, to: l.from })),
      ),
    );
    expect(reopened.records.get('left')?.mark).toBe('ready');
    expect(caseLeads(reopened, now).some((lead) => lead.id === 'access')).toBe(false);
  });
  it('keeps 10,000 records and all dependency evidence accounted for through aggregate drill-down', () => {
    const items = Array.from({ length: 10000 }, (_, i) => ({
      id: `work-${String(i).padStart(5, '0')}`,
      archived: i % 7 === 0,
    }));
    const links = items.slice(1).map((item, i) => needs(item.id, items[i]!.id));
    const graph = caseGraph(fixture(items, links)),
      leads = caseLeads(graph, now);
    expect(leads[0]).toMatchObject({ id: items[0]!.id, opens: 1, reaches: 9999 });
    let session = newCaseSession('case'),
      board = projectCase(graph, session, leads);
    expect(board.cards.length).toBeLessThanOrEqual(32);
    expect(new Set(board.cards.flatMap((card) => card.ids)).size).toBe(10000);
    expect(
      board.threads.reduce((sum, thread) => sum + thread.count, 0) +
        board.cards.reduce((sum, card) => sum + card.internalLinks, 0),
    ).toBe(9999);
    const last = items.at(-1)!.id;
    for (let depth = 0; depth < 6; depth++) {
      const card = board.cards.find((c) => c.ids.includes(last))!;
      expect(card).toBeDefined();
      session = caseTransition(graph, session, { type: 'open', card });
      if (card.recordId) break;
      board = projectCase(graph, session, leads);
    }
    expect(session.focus).toBe(last);
    expect(caseReach(graph, last, 'needs').size).toBe(10000);
  });
  it('restores only existing workspace records, keeps pins without silent eviction, and can return to the whole case', () => {
    const graph = caseGraph(fixture(Array.from({ length: 40 }, (_, i) => ({ id: `file-${i}` }))));
    let session = newCaseSession('case');
    for (const id of graph.ordered.slice(0, 12))
      session = caseTransition(graph, session, { type: 'pin', id });
    const pins = [...session.pins];
    session = caseTransition(graph, session, { type: 'pin', id: graph.ordered[12]! });
    expect(session.pins).toEqual(pins);
    session = caseTransition(graph, session, { type: 'focus', id: 'file-39' });
    session.query = 'unremembered search';
    const restored = restoreCaseSession(graph, JSON.parse(JSON.stringify(session)));
    expect(restored.focus).toBe('file-39');
    expect(restored.pins).toEqual(pins);
    expect(restored.query).toBe('');
    expect(restoreCaseSession(graph, { ...session, workspaceId: 'another' }).pins).toEqual([]);
    const scoped = caseTransition(graph, restored, {
      type: 'open',
      card: projectCase(graph, restored, []).cards[0]!,
    });
    expect(caseTransition(graph, scoped, { type: 'overview' }).scope).toBeNull();
  });
  it('makes narrowed coverage explicit and retains stable card positions across status updates', () => {
    const source = fixture(
      [
        { id: 'a', title: 'Find the source', tags: ['reference'] },
        { id: 'b', status: 'done' },
        { id: 'c', archived: true },
      ],
      [needs('b', 'a')],
    );
    const graph = caseGraph(source),
      session = newCaseSession('case'),
      before = projectCase(graph, session, []);
    session.query = 'reference';
    const filtered = projectCase(graph, session, []);
    expect(filtered.counts.total).toBe(1);
    expect(filtered.workspaceCounts.total).toBe(3);
    expect(filtered.outsideLinks).toBe(1);
    source.items[0]!.status = 'done';
    session.query = '';
    const after = projectCase(caseGraph(source), session, []);
    expect(after.cards.map(({ id, x, y }) => ({ id, x, y }))).toEqual(
      before.cards.map(({ id, x, y }) => ({ id, x, y })),
    );
  });
});
