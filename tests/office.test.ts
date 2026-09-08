import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore, WorkService } from '@statework/sdk';
import type { Command } from '@statework/sdk';
import * as THREE from 'three';
import {
  starterSnapshot,
  starterTasks,
  statusCommand,
} from '../packages/reference/src/spatial/model';
import {
  officeCatalog,
  newOfficeSession,
  officeTransition,
  reconcileOffice,
  traceDependencies,
  isSealed,
} from '../packages/reference/src/spatial/office-model';
import { OfficeWorld } from '../packages/reference/src/spatial/office-world';
import { pickAction } from '../packages/reference/src/spatial/scene';
import type { SpatialView } from '../packages/reference/src/spatial/scene';

function fixture() {
  const at = '2026-09-09T10:00:00.000Z';
  const work = new WorkService(new MemoryStore(), () => at).connect('owner');
  work.import(
    starterSnapshot({ id: 'source', title: 'Studio', project: 'Release', tasks: starterTasks }, at),
    { id: 'office', title: 'Studio' },
  );
  let serial = 0;
  const execute = (commands: Command[]) =>
    work.execute('office', {
      schemaVersion: 1,
      requestId: `change-${++serial}`,
      expectedRevision: work.snapshot('office').workspace.revision,
      commands,
    });
  const status = (id: string, value: 'done' | 'ready' | 'cancelled') =>
    execute([statusCommand(work.snapshot('office').items.find((i) => i.id === id)!, value)]);
  const catalog = () => officeCatalog(work.snapshot('office'), 'owner');
  return { work, execute, status, catalog };
}

describe('filing is a complete projection of the real work graph', () => {
  it('keeps archived records and every page without mutating its input', () => {
    const f = fixture();
    f.execute([{ type: 'item.archive', id: 'step-1', expectedVersion: 1, archived: true }]);
    for (let batch = 0; batch < 6; batch++)
      f.execute(
        Array.from({ length: 100 }, (_, i) => ({
          type: 'item.create' as const,
          item: { id: `extra-${batch}-${i}`, kind: 'task' as const, title: `Extra ${batch}-${i}` },
        })),
      );
    const state = f.work.snapshot('office'),
      before = structuredClone(state),
      catalog = officeCatalog(state, 'owner');
    expect(state).toEqual(before);
    expect(catalog.files).toHaveLength(606);
    expect(new Set(catalog.cabinets.flatMap((c) => c.fileIds)).size).toBe(606);
    expect(catalog.files.find((f) => f.id === 'step-1')?.archived).toBe(true);
    expect(catalog.files.every((f) => !!f.node)).toBe(true);
    expect(catalog.files.find((f) => f.id === 'step-3')?.missingKeys).toContain('step-1');
  });
  it('requires every earned key, revokes reopened keys, and never bypasses SDK validation', () => {
    const f = fixture();
    let session = newOfficeSession('office');
    session = officeTransition(session, f.catalog(), { type: 'unlock', id: 'step-3' });
    expect(session.xray).toBe(true);
    expect(session.unlatched).toEqual([]);
    expect(() => f.status('step-3', 'done')).toThrow();
    f.status('step-1', 'done');
    expect(f.catalog().keys.map((k) => k.id)).toEqual(['step-1']);
    expect(f.catalog().files.find((f) => f.id === 'step-3')?.missingKeys).toEqual(['step-2']);
    f.status('step-2', 'cancelled');
    expect(f.catalog().keys.find((k) => k.id === 'step-2')?.waived).toBe(true);
    const file = f.catalog().files.find((f) => f.id === 'step-3')!;
    expect(isSealed(session, file)).toBe(true);
    session = officeTransition(session, f.catalog(), { type: 'unlock', id: file.id });
    expect(isSealed(session, file)).toBe(false);
    f.status('step-1', 'ready');
    session = reconcileOffice(session, f.catalog());
    expect(session.unlatched).not.toContain('step-3');
    expect(f.catalog().keys.map((k) => k.id)).not.toContain('step-1');
    expect(() => f.status('step-3', 'done')).toThrow();
  });
  it('traces all upstream requirements and direct dependents across cabinets', () => {
    const f = fixture(),
      c = f.catalog();
    const trace = traceDependencies(c, 'step-4');
    expect(new Set(trace.ids)).toEqual(new Set(['step-1', 'step-2', 'step-3', 'step-4', 'step-5']));
    expect(trace.edges).toContainEqual({ from: 'step-5', to: 'step-4' });
    expect(trace.missing).toHaveLength(4);
    expect(
      officeCatalog(f.work.snapshot('office'), 'reader').files.every((f) =>
        f.node.actions.filter((a) => a.id !== 'open').every((a) => !a.enabled),
      ),
    ).toBe(true);
  });
  it('keeps presentation reset separate from records and clamps stale pages and drawers', () => {
    const f = fixture(),
      c = f.catalog(),
      before = f.work.snapshot('office');
    let s = newOfficeSession('office');
    s = officeTransition(s, c, { type: 'hold', id: 'step-3', hand: 'left' });
    s = officeTransition(s, c, { type: 'quick-view' });
    s = officeTransition(s, c, { type: 'dependencies' });
    s = officeTransition(s, c, { type: 'pin' });
    expect(s.held?.hand).toBe('left');
    expect(s.pinned).toEqual(['step-3']);
    s = officeTransition(s, c, { type: 'file-all' });
    expect(s.held).toBeNull();
    expect(s.xray).toBe(false);
    expect(s.pinned).toEqual([]);
    expect(f.work.snapshot('office')).toEqual(before);
    s.cabinetPage = s.keyPage = s.quickPage = 900;
    s.cabinetSheets[c.cabinets[0]!.id] = 800;
    s.drawers[`${c.cabinets[0]!.id}/0`] = true;
    c.cabinets[0]!.requiredKeys = ['missing'];
    c.cabinets[0]!.missingKeys = ['missing'];
    const clean = reconcileOffice(s, c);
    expect([
      clean.cabinetPage,
      clean.quickPage,
      clean.keyPage,
      ...Object.values(clean.cabinetSheets),
    ]).toEqual([0, 0, 0, 0, 0]);
    expect(clean.drawers).toEqual({});
    expect(reconcileOffice(clean, { ...c, workspaceId: 'another' })).toEqual(
      newOfficeSession('another'),
    );
  });
});

// Geometry and grip tests use real Three objects. Only text rasterization is stubbed;
// full WebGL rendering and XR input are exercised separately in browser tests.
function geometryWorld() {
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const ctx = {
    fillRect() {},
    fillText() {},
    measureText: (t: string) => ({ width: t.length * 20 }),
  };
  vi.stubGlobal('document', {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  });
  const f = fixture(),
    catalog = f.catalog(),
    events: string[] = [];
  const world = new OfficeWorld(
    (a) => events.push(a),
    () => {},
  );
  const scene = new THREE.Scene(),
    camera = new THREE.PerspectiveCamera(57, 2),
    left = new THREE.Group(),
    right = new THREE.Group();
  scene.add(world.root, camera, left, right);
  world.setHands(
    camera,
    new Map([
      ['left', left],
      ['right', right],
    ]),
  );
  const file = catalog.files.find((f) => f.id === 'step-3')!;
  const view: SpatialView = {
    catalog,
    title: 'Studio',
    nodes: catalog.files.map((f) => f.node),
    selected: file.node,
    detail: 'A real next action',
    links: [],
    actions: [{ id: 'complete', label: 'Finish', enabled: false }],
    context: [],
    pageLabel: '1/1',
    previous: false,
    next: false,
    message: '',
    busy: false,
    large: false,
    audio: false,
  };
  world.update(view);
  return { world, scene, camera, left, right, view, events, f };
}
afterEach(() => vi.unstubAllGlobals());
describe('actual office geometry and interactions', () => {
  it('attaches held folders to grip space and recovers tracking loss without writes', () => {
    const { world, left, events } = geometryWorld();
    world.hold('step-3', 'left');
    const held = left.getObjectByName('file:step-3')!;
    expect(held).toBeDefined();
    expect(held.parent).toBe(left);
    expect(world.targetsFor('left').some((t) => t.fileId === 'step-3')).toBe(false);
    expect(world.targetsFor('right').some((t) => t.fileId === 'step-3')).toBe(true);
    left.position.set(1, 1.4, -0.5);
    left.updateMatrixWorld(true);
    expect(held.getWorldPosition(new THREE.Vector3()).x).toBe(1);
    world.action('office:finish', 'left');
    expect(events).not.toContain('complete');
    world.returnHeldFromLostTracking('left');
    expect(world.heldId).toBeNull();
    expect(left.children).toHaveLength(0);
    world.dispose();
  });
  it('hides closed files from rays, reveals dependencies and returns Quick View files home', () => {
    const { world, scene, view, camera } = geometryWorld();
    const file = world.root.getObjectByName('file:step-1')!;
    expect(file.visible).toBe(false);
    const point = file.getWorldPosition(new THREE.Vector3());
    const ray = new THREE.Raycaster(
      point.clone().add(new THREE.Vector3(0, 0, 1)),
      new THREE.Vector3(0, 0, -1),
    );
    expect(
      pickAction(
        ray,
        world.targets.filter((t) => t.fileId === 'step-1'),
      ),
    ).toBeNull();
    world.hold('step-3', 'desktop');
    world.action('office:dependencies');
    let related = world.root.getObjectByName('file:step-1')!;
    expect(related.visible).toBe(true);
    related.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        // Layers 1 and 2 are eye-specific in Three; X-ray must render in both eyes.
        expect(o.layers.mask & 0b110).toBe(0);
        expect(o.layers.isEnabled(3)).toBe(true);
        expect((o.material as THREE.Material).depthTest).toBe(true);
      }
    });
    const cameraBefore = camera.position.clone();
    world.action('office:quick');
    related = world.root.getObjectByName('file:step-1')!;
    expect(related.position.z).toBe(0.52);
    expect(related.visible).toBe(true);
    expect(camera.position).toEqual(cameraBefore);
    world.action('office:file-all');
    related = world.root.getObjectByName('file:step-1')!;
    expect(related.visible).toBe(false);
    expect(world.feedback.xray).toBe(false);
    expect(scene.getObjectByName('file:step-3')).toBeDefined();
    expect(view.catalog.files).toHaveLength(6);
    world.dispose();
  });
  it('shows off-bank prerequisites and all six-key pages, then disposes replaced assets', () => {
    const { world, view, f } = geometryWorld();
    f.execute(
      Array.from({ length: 15 }, (_, i) => ({
        type: 'item.create' as const,
        item: {
          id: `remote-${i}`,
          kind: 'task' as const,
          title: `Remote ${i}`,
          status: 'done' as const,
        },
      })),
    );
    f.execute(
      Array.from({ length: 15 }, (_, i) => ({
        type: 'relation.add' as const,
        relation: {
          id: `needs-${i}`,
          kind: 'depends_on' as const,
          from: 'step-3',
          to: `remote-${i}`,
        },
      })),
    );
    const catalog = f.catalog();
    world.update({ ...view, catalog });
    world.hold('step-3', 'right');
    world.action('office:dependencies');
    world.action('office:quick');
    const seen = new Set<string>();
    for (let p = 0; p < 4; p++) {
      world.root.traverse((o) => {
        if (o.name.startsWith('file:') && o.position.z === 0.52) seen.add(o.name.slice(5));
      });
      world.action('office:quick-next');
    }
    expect([...seen].filter((id) => id.startsWith('remote-'))).toHaveLength(15);
    expect(world.feedback.keys).toBe(15);
    world.action('office:keys-next');
    world.action('office:keys-next');
    expect(world.feedback.keyPage).toBe('3/3');
    expect(world.targets.filter((t) => t.action === 'key:remote-14').length).toBeGreaterThan(0);
    const geometry = world.targets.find((t) => t.fileId === 'step-1')!.mesh.geometry,
      disposed = vi.fn();
    geometry.addEventListener('dispose', disposed);
    world.action('office:file-all');
    expect(disposed).toHaveBeenCalledOnce();
    world.dispose();
  });
  it('X-ray ray picks follow the visible overlay, including behind a closed drawer', () => {
    const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const drawer = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    const file = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    drawer.position.z = -1;
    file.position.z = -2;
    file.layers.set(3);
    drawer.updateMatrixWorld();
    file.updateMatrixWorld();
    const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, 0, -1));
    ray.layers.enableAll();
    expect(
      pickAction(ray, [
        { mesh: drawer, action: 'drawer' },
        { mesh: file, action: 'folder' },
      ]),
    ).toBe('folder');
    file.visible = false;
    expect(
      pickAction(ray, [
        { mesh: drawer, action: 'drawer' },
        { mesh: file, action: 'folder' },
      ]),
    ).toBe('drawer');
    drawer.geometry.dispose();
    file.geometry.dispose();
    material.dispose();
  });
});
