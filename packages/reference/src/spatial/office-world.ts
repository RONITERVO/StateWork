import * as THREE from 'three';
import { OfficeArt, makeFolder, makeKey, makeOfficeShell } from './office-art';
import {
  cabinetCapacity,
  isSealed,
  newOfficeSession,
  officeTransition,
  reconcileOffice,
  traceDependencies,
} from './office-model';
import type { OfficeHand, OfficeIntent, OfficeSession } from './office-model';
import { stateMark } from './model';
import type { SpatialView } from './scene';
import { DetectiveWall } from './detective-wall';
import { CalendarWall } from './calendar-wall';

export interface OfficeTarget {
  mesh: THREE.Mesh;
  action: string;
  fileId?: string;
}
export interface OfficeFeedback {
  held: string | null;
  xray: boolean;
  quickView: boolean;
  message: string;
  keys: number;
  cabinetPage: string;
  relatedPage: string;
  keyPage: string;
}
interface FolderActor {
  root: THREE.Group;
  home: THREE.Vector3;
  homeRotation: THREE.Euler;
  velocity: THREE.Vector3;
  loose: boolean;
}
const fileColor = (mark: string) =>
  ({
    ready: '#c5a365',
    active: '#6d9b87',
    waiting: '#bd8854',
    done: '#759c82',
    cancelled: '#969b8d',
  })[mark] ?? '#c5a365';

export class OfficeWorld {
  readonly root = new THREE.Group();
  private workTargets: OfficeTarget[] = [];
  private detective = new DetectiveWall();
  private calendar = new CalendarWall();
  get targets(): OfficeTarget[] {
    return [...this.workTargets, ...this.detective.targets, ...this.calendar.targets];
  }
  private staticArt = new OfficeArt();
  private dynamicArt = new OfficeArt();
  private shell: THREE.Group;
  private content = new THREE.Group();
  private folderActors = new Map<string, FolderActor>();
  private drawers = new Map<string, { root: THREE.Group; goal: number }>();
  private gripRoots = new Map<OfficeHand, THREE.Object3D>();
  private camera?: THREE.Camera;
  private view?: SpatialView;
  private session: OfficeSession = newOfficeSession('');
  private lastCatalog = '';
  private heldKey: { id: string; hand: OfficeHand; root: THREE.Group } | null = null;
  private released = new Map<
    string,
    { position: THREE.Vector3; rotation: THREE.Euler; velocity: THREE.Vector3 }
  >();
  private traceLines = new THREE.Group();
  private keyActors = new Map<string, THREE.Group>();
  private highlight?: THREE.BoxHelper;
  private lastHeldPosition = new THREE.Vector3();
  private handVelocity = new THREE.Vector3();
  private motion = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  private history: string[] = [];
  private immersive = false;
  private lamp = new THREE.PointLight('#ffdf9c', 1.2, 3.5, 2);
  private stamp?: THREE.Group;
  private stampMotion = 0;
  private shadowTransforms = new Map<THREE.Object3D, THREE.Matrix4>();

  constructor(
    private act: (action: string) => void,
    private changed: (feedback: OfficeFeedback) => void,
  ) {
    this.root.name = 'StateWork interactive office';
    this.shell = makeOfficeShell(this.staticArt);
    this.root.add(
      this.shell,
      this.content,
      this.traceLines,
      this.detective.root,
      this.calendar.root,
    );
    this.lamp.position.set(1.2, 1.26, -0.12);
    this.lamp.layers.enableAll();
    this.root.add(this.lamp);
  }
  setHands(camera: THREE.Camera, grips: Map<OfficeHand, THREE.Object3D>) {
    this.camera = camera;
    this.gripRoots = grips;
    const aspect = (camera as THREE.PerspectiveCamera).aspect;
    const capacity = this.immersive ? 5 : aspect < 1 ? 1 : aspect < 1.65 ? 2 : 5;
    if (this.session.relatedCapacity !== capacity) {
      this.session.relatedCapacity = capacity;
      this.session.quickPage = 0;
      this.rebuild();
      this.changed(this.feedback);
    }
    this.placeHeld();
  }
  setImmersive(active: boolean) {
    this.immersive = active;
    if (this.camera) this.setHands(this.camera, this.gripRoots);
    this.rebuild();
  }
  get heldId() {
    return this.session.held?.id ?? null;
  }
  targetsFor(hand: OfficeHand): OfficeTarget[] {
    const folder =
      this.session.held?.hand === hand
        ? this.folderActors.get(this.session.held.id)?.root
        : undefined;
    const key = this.heldKey?.hand === hand ? this.heldKey.root : undefined;
    // A ray must be able to leave its own hand. One controller can use every
    // desk control while holding a file; the other ray can use its attached tabs.
    return this.targets.filter((target) => {
      for (let node: THREE.Object3D | null = target.mesh; node; node = node.parent)
        if (node === folder || node === key) return false;
      return true;
    });
  }
  get feedback(): OfficeFeedback {
    return {
      held: this.heldId,
      xray: this.session.xray,
      quickView: this.session.quickView,
      message: this.session.message,
      keys: this.view?.catalog.keys.length ?? 0,
      cabinetPage: `${this.session.cabinetPage + 1}/${Math.max(1, Math.ceil((this.view?.catalog.cabinets.length ?? 0) / 3))}`,
      relatedPage: `${this.session.quickPage + 1}/${Math.max(1, Math.ceil(((this.view ? traceDependencies(this.view.catalog, this.heldId ?? this.session.inspected ?? '').ids.length : 0) - 1) / this.session.relatedCapacity))}`,
      keyPage: `${this.session.keyPage + 1}/${Math.max(1, Math.ceil((this.view?.catalog.keys.length ?? 0) / 6))}`,
    };
  }
  inspect(id: string) {
    if (this.session.inspected === id && (!this.session.held || this.session.held.id === id))
      return;
    const previous = this.session.held?.id ?? this.session.inspected;
    if (previous && previous !== id) this.history.push(previous);
    if (this.session.held && this.session.held.id !== id) this.release(this.session.held.hand);
    this.dispatch({ type: 'inspect', id });
  }
  update(view: SpatialView) {
    this.detective.update(view.board, view.large, view.movement !== false);
    this.calendar.update(view.calendar);
    const oldKeys = new Set(this.view?.catalog.keys.map((k) => k.id) ?? []);
    const switched = this.view?.catalog.workspaceId !== view.catalog.workspaceId;
    this.view = view;
    this.session = reconcileOffice(this.session, view.catalog);
    const aspect = (this.camera as THREE.PerspectiveCamera)?.aspect ?? 2;
    this.session.relatedCapacity = this.immersive ? 5 : aspect < 1 ? 1 : aspect < 1.65 ? 2 : 5;
    if (switched) {
      this.released.clear();
      this.heldKey = null;
      this.history = [];
    }
    if (view.selected && !this.session.held) this.session.inspected = view.selected.id;
    const newKey = view.catalog.keys.find((key) => !oldKeys.has(key.id));
    if (newKey && !switched)
      this.session.message = `Key earned: ${newKey.label}. Find it on your key tray.`;
    const signature = JSON.stringify([
      view.catalog,
      view.selected?.id,
      view.detail,
      view.actions,
      view.context,
      view.busy,
      view.large,
      view.audio,
      view.message,
      this.session,
    ]);
    if (signature !== this.lastCatalog) {
      this.lastCatalog = signature;
      this.rebuild();
    }
    this.changed(this.feedback);
  }
  private dispatch(intent: OfficeIntent) {
    if (!this.view) return;
    this.session = officeTransition(this.session, this.view.catalog, intent);
    this.rebuild();
    this.changed(this.feedback);
  }
  /** Stable actions are shared by ray picks, near grabs and the DOM office controls. */
  action(action: string, hand: OfficeHand = 'desktop'): boolean {
    if (!this.view) return false;
    if (action === 'prop:lamp') {
      this.lamp.visible = !this.lamp.visible;
      this.session.message = this.lamp.visible ? 'Desk light on.' : 'Desk light off.';
      this.changed(this.feedback);
      return true;
    }
    if (action === 'office:back') {
      const id = this.history.pop();
      if (id && this.view.catalog.files.some((f) => f.id === id)) {
        if (this.session.held) this.release(this.session.held.hand);
        this.dispatch({ type: 'hold', id, hand });
        this.act(`select:${id}`);
      }
      return true;
    }
    if (action.startsWith('folder:')) {
      this.hold(action.slice(7), hand);
      return true;
    }
    if (action.startsWith('drawer:')) {
      const raw = action.slice(7),
        index = Number(raw.slice(raw.lastIndexOf('/') + 1)),
        cabinetId = raw.slice(0, raw.lastIndexOf('/'));
      this.dispatch({ type: 'drawer', cabinetId, index });
      return true;
    }
    if (action.startsWith('lock:')) {
      const id = action.slice(5),
        target =
          this.view.catalog.files.find((f) => f.id === id) ??
          this.view.catalog.cabinets.find((c) => c.id === id);
      if (this.heldKey && target && !target.requiredKeys.includes(this.heldKey.id)) {
        this.session.message = 'That key does not fit. Use the key ring or follow Dependencies.';
        this.changed(this.feedback);
        return true;
      }
      this.dispatch({ type: 'unlock', id });
      return true;
    }
    if (action.startsWith('key:')) {
      if (this.session.held?.hand === hand && hand !== 'desktop') this.release(hand);
      if (this.heldKey) {
        this.heldKey = null;
        this.rebuild();
      }
      const id = action.slice(4),
        key = this.keyActors.get(id);
      if (key) {
        this.heldKey = { id, hand, root: key };
        this.placeHeld();
        this.session.message = 'Key in hand. Point at a matching lock to use it.';
        this.changed(this.feedback);
      }
      return true;
    }
    if (action === 'office:hold') {
      const id = this.view.selected?.id;
      if (id) this.hold(id, hand);
      return true;
    }
    if (action === 'office:release') {
      this.release(hand);
      return true;
    }
    if (action === 'office:dependencies') {
      this.dispatch({ type: 'dependencies' });
      return true;
    }
    if (action === 'office:quick') {
      this.dispatch({ type: 'quick-view' });
      return true;
    }
    if (action === 'office:quick-next' || action === 'office:quick-previous') {
      this.dispatch({ type: 'quick-page', delta: action.endsWith('next') ? 1 : -1 });
      return true;
    }
    if (action === 'office:keys-next' || action === 'office:keys-previous') {
      this.dispatch({ type: 'key-page', delta: action.endsWith('next') ? 1 : -1 });
      return true;
    }
    if (action === 'office:cabinets-next' || action === 'office:cabinets-previous') {
      this.dispatch({ type: 'cabinet-page', delta: action.endsWith('next') ? 1 : -1 });
      return true;
    }
    if (action.startsWith('sheet:')) {
      const pieces = action.slice(6).split('/');
      const delta = Number(pieces.pop());
      this.dispatch({ type: 'cabinet-sheet', id: pieces.join('/'), delta });
      return true;
    }
    if (action === 'office:unlock') {
      const id = this.session.held?.id ?? this.session.inspected;
      if (id) this.dispatch({ type: 'unlock', id });
      return true;
    }
    if (action === 'office:pin') {
      this.dispatch({ type: 'pin' });
      return true;
    }
    if (action === 'office:file-all') {
      this.released.clear();
      this.heldKey = null;
      this.dispatch({ type: 'file-all' });
      return true;
    }
    if (action === 'office:finish') {
      const id = this.session.held?.id ?? this.session.inspected,
        file = this.view.catalog.files.find((f) => f.id === id);
      if (file && isSealed(this.session, file)) {
        this.dispatch({ type: 'unlock', id: file.id });
        return true;
      }
      if (this.view.actions.some((a) => a.id === 'complete' && a.enabled) && !this.view.busy) {
        this.stampMotion = this.motion ? 1 : 0;
        this.act('complete');
      } else {
        this.session.message =
          'Finish the prerequisites first. The key ring shows what is missing.';
        this.changed(this.feedback);
      }
      return true;
    }
    return false;
  }
  hold(id: string, hand: OfficeHand) {
    if (this.heldKey?.hand === hand && hand !== 'desktop') this.heldKey = null;
    const previous = this.session.held?.id ?? this.session.inspected;
    if (previous && previous !== id) this.history.push(previous);
    if (this.session.held && this.session.held.id !== id) this.release(this.session.held.hand);
    this.released.delete(id);
    this.dispatch({ type: 'hold', id, hand });
    this.act(`select:${id}`);
  }
  release(hand?: OfficeHand) {
    const held = this.session.held;
    if (held && (!hand || hand === 'desktop' || held.hand === hand)) {
      const actor = this.folderActors.get(held.id);
      if (actor) {
        this.root.updateMatrixWorld(true);
        actor.root.updateWorldMatrix(true, false);
        this.root.attach(actor.root);
        const position = actor.root.position.clone();
        // Desk/floor collision bounds prevent losing a released file behind furniture.
        position.x = THREE.MathUtils.clamp(position.x, -1.35, 1.35);
        position.z = THREE.MathUtils.clamp(position.z, -0.15, 1.3);
        position.y = Math.max(position.y, 1.0);
        this.released.set(held.id, {
          position,
          rotation: actor.root.rotation.clone(),
          velocity: this.handVelocity.clone().clampLength(0, 1.8),
        });
      }
      this.dispatch({ type: 'release' });
    }
    if (this.heldKey && (!hand || hand === 'desktop' || this.heldKey.hand === hand)) {
      this.heldKey = null;
      this.rebuild();
    }
  }
  grabNearest(point: THREE.Vector3, hand: OfficeHand) {
    let nearest: { id: string; distance: number } | undefined;
    for (const [id, actor] of this.folderActors) {
      if (!actor.root.visible) continue;
      const distance = actor.root.getWorldPosition(new THREE.Vector3()).distanceTo(point);
      if (distance < 0.28 && (!nearest || distance < nearest.distance)) nearest = { id, distance };
    }
    if (nearest) {
      this.hold(nearest.id, hand);
      return true;
    }
    for (const [id, key] of this.keyActors) {
      if (key.getWorldPosition(new THREE.Vector3()).distanceTo(point) < 0.16)
        return this.action(`key:${id}`, hand);
    }
    return false;
  }
  returnHeldFromLostTracking(hand: OfficeHand) {
    if (this.session.held?.hand === hand) {
      this.released.delete(this.session.held.id);
      this.dispatch({ type: 'release' });
    }
    if (this.heldKey?.hand === hand) {
      this.heldKey = null;
      this.rebuild();
    }
  }
  private bind(group: THREE.Object3D, action: string, fileId?: string) {
    group.traverse((object) => {
      if (object instanceof THREE.Mesh) this.workTargets.push({ mesh: object, action, fileId });
    });
  }
  private button(
    parent: THREE.Object3D,
    label: string,
    action: string,
    x: number,
    y: number,
    z: number,
    width = 0.23,
    height = 0.07,
    enabled = true,
    color = '#dec693',
  ) {
    const block = this.dynamicArt.box(
      parent,
      [width, height, 0.032],
      [x, y, z],
      this.dynamicArt.material('cream', enabled ? color : '#847f70'),
      0.009,
    );
    const plate = this.dynamicArt.label(
      parent,
      label,
      '',
      width * 0.91,
      height * 0.78,
      [x, y, z + 0.017],
      { background: enabled ? color : '#847f70', size: 82, color: '#1c382f' },
    );
    if (enabled) {
      this.bind(block, action);
      this.bind(plate, action);
    }
    return block;
  }
  private clearDynamic() {
    this.hover(null);
    this.shadowTransforms.clear();
    for (const actor of this.folderActors.values()) actor.root.removeFromParent();
    for (const key of this.keyActors.values()) key.removeFromParent();
    this.content.clear();
    this.traceLines.clear();
    this.dynamicArt.dispose();
    this.dynamicArt = new OfficeArt();
    this.workTargets.length = 0;
    this.folderActors.clear();
    this.drawers.clear();
    this.keyActors.clear();
  }
  private rebuild() {
    const view = this.view;
    if (!view) return;
    const previousDrawers = new Map([...this.drawers].map(([id, d]) => [id, d.root.position.z]));
    const oldHeldKey = this.heldKey ? { id: this.heldKey.id, hand: this.heldKey.hand } : null;
    this.clearDynamic();
    this.bind(this.shell.getObjectByName('office:phone')!, 'next-focus');
    this.bind(this.shell.getObjectByName('office:lamp')!, 'prop:lamp');
    const art = this.dynamicArt,
      catalog = view.catalog;
    art.textScale = view.large ? 1.24 : 1;
    const activeId = this.session.held?.id ?? this.session.inspected ?? view.selected?.id;
    const trace = activeId
      ? traceDependencies(catalog, activeId)
      : { ids: [], edges: [], missing: [] };
    const relevant = new Set(trace.ids);
    const byId = new Map(catalog.files.map((f) => [f.id, f]));
    const cabinets = catalog.cabinets.slice(
      this.session.cabinetPage * 3,
      this.session.cabinetPage * 3 + 3,
    );
    const placed = new Set<string>();
    cabinets.forEach((cabinet, slot) => {
      const group = new THREE.Group();
      group.position.set((slot - 1) * 1.6, 0, -1.93);
      this.content.add(group);
      const cabinetMetal = art.material('metal', slot % 2 ? '#687d72' : '#78897e');
      art.box(group, [1.14, 1.91, 0.68], [0, 1.01, 0], cabinetMetal, 0.03);
      art.box(group, [1.04, 1.79, 0.024], [0, 1.02, 0.354], 'dark', 0.004);
      art.label(
        group,
        cabinet.label,
        `${cabinet.fileIds.length} FILES  /  CABINET ${this.session.cabinetPage * 3 + slot + 1}`,
        0.96,
        0.2,
        [0, 2.06, 0.19],
        { background: '#e8d3a7', size: 66 },
      );
      for (const x of [-0.45, 0.45]) art.box(group, [0.1, 0.11, 0.5], [x, 0.065, 0], 'dark');
      if (cabinet.requiredKeys.length) {
        const lock = art.torus(
          group,
          0.042,
          0.01,
          [0.47, 1.92, 0.35],
          isSealed(this.session, cabinet) ? 'brass' : 'metal',
        );
        this.bind(lock, `lock:${cabinet.id}`);
        art.label(
          group,
          isSealed(this.session, cabinet) ? 'LOCKED' : 'OPEN',
          '',
          0.17,
          0.06,
          [0.37, 1.83, 0.36],
          { size: 80 },
        );
      }
      const sheet = this.session.cabinetSheets[cabinet.id] ?? 0;
      for (let row = 0; row < 3; row++) {
        const drawer = new THREE.Group();
        drawer.position.set(
          0,
          0.39 + (2 - row) * 0.57,
          previousDrawers.get(`${cabinet.id}/${row}`) ?? 0,
        );
        group.add(drawer);
        const open = !!this.session.drawers[`${cabinet.id}/${row}`];
        this.drawers.set(`${cabinet.id}/${row}`, { root: drawer, goal: open ? 0.52 : 0 });
        const front = art.box(drawer, [1.04, 0.5, 0.045], [0, 0, 0.39], cabinetMetal, 0.012);
        this.bind(front, `drawer:${cabinet.id}/${row}`);
        const handle = art.box(drawer, [0.27, 0.032, 0.075], [0, 0.04, 0.446], 'brass');
        this.bind(handle, `drawer:${cabinet.id}/${row}`);
        const label = art.label(
          drawer,
          `${String(sheet * 12 + row * 4 + 1).padStart(2, '0')} — ${String(Math.min(cabinet.fileIds.length, sheet * 12 + (row + 1) * 4)).padStart(2, '0')}`,
          '',
          0.25,
          0.075,
          [0, -0.085, 0.416],
          { size: 100 },
        );
        this.bind(label, `drawer:${cabinet.id}/${row}`);
        art.box(drawer, [0.98, 0.025, 0.62], [0, -0.225, 0.05], 'metal');
        for (const x of [-0.48, 0.48])
          art.box(drawer, [0.022, 0.42, 0.61], [x, -0.02, 0.05], 'metal');
        for (let j = 0; j < 4; j++) {
          const id = cabinet.fileIds[sheet * 12 + row * 4 + j],
            file = id ? byId.get(id) : undefined;
          if (!file) continue;
          const folder = this.addFolder(
            file.id,
            drawer,
            new THREE.Vector3(
              (j - 1.5) * 0.24,
              open ? 0.38 : 0.03,
              open ? 0.34 : -0.15 + j * 0.115,
            ),
            false,
          );
          folder.root.scale.setScalar(open ? 0.54 : 1);
          folder.root.visible =
            open ||
            (this.session.xray && relevant.has(file.id)) ||
            this.session.held?.id === file.id;
          placed.add(file.id);
        }
      }
      if (cabinet.fileIds.length > cabinetCapacity) {
        this.button(
          group,
          'PREV',
          `sheet:${cabinet.id}/-1`,
          -0.25,
          0.02,
          0.45,
          0.26,
          0.07,
          sheet > 0,
        );
        this.button(
          group,
          'NEXT',
          `sheet:${cabinet.id}/1`,
          0.25,
          0.02,
          0.45,
          0.26,
          0.07,
          (sheet + 1) * 12 < cabinet.fileIds.length,
        );
      }
    });
    // The trace index is complete; render a bounded window for headset frame budgets.
    // The same five-file paging works in X-ray and Quick View, including off-bank files.
    const quickIds = trace.ids
      .filter((id) => id !== activeId)
      .slice(
        this.session.quickPage * this.session.relatedCapacity,
        (this.session.quickPage + 1) * this.session.relatedCapacity,
      );
    const extra = new Set([
      ...(this.session.xray || this.session.quickView ? quickIds : []),
      ...this.session.pinned,
      ...this.released.keys(),
      ...(activeId ? [activeId] : []),
    ]);
    let extraIndex = 0;
    for (const id of extra) {
      if (placed.has(id) || !byId.has(id)) continue;
      const x = ((extraIndex % 6) - 2.5) * 0.5,
        y = 2.5 - Math.floor(extraIndex / 6) * 0.42;
      const actor = this.addFolder(id, this.content, new THREE.Vector3(x, y, -2.3), true);
      actor.root.scale.setScalar(0.82);
      actor.root.visible =
        this.session.xray ||
        this.session.quickView ||
        this.session.pinned.includes(id) ||
        this.released.has(id) ||
        this.session.held?.id === id;
      placed.add(id);
      extraIndex++;
    }
    if (this.session.quickView)
      quickIds.forEach((id, i) => {
        const actor = this.folderActors.get(id);
        if (!actor) return;
        this.content.attach(actor.root);
        actor.root.visible = true;
        actor.root.userData.quickView = true;
        if (this.immersive)
          actor.root.position.set(((i % 3) - 1) * 0.44, 1.42 + Math.floor(i / 3) * 0.4, 1.48);
        else if (this.session.relatedCapacity === 1)
          actor.root.position.set(0, this.session.held ? 2.45 : 1.7, 0.52);
        else actor.root.position.set(0.25 + (i % 3) * 0.48, 1.64 + Math.floor(i / 3) * 0.42, 0.52);
        actor.root.rotation.set(0, 0, 0);
        actor.root.scale.setScalar(1);
      });
    this.session.pinned.forEach((id, i) => {
      if (id === activeId && this.session.held) return;
      const actor = this.folderActors.get(id);
      if (!actor) return;
      this.content.attach(actor.root);
      actor.root.visible = true;
      actor.root.position.set(-1.18 + i * 0.48, 1.14, 0.62);
      actor.root.rotation.set(-0.28, 0, 0);
      actor.root.scale.setScalar(0.8);
    });
    for (const [id, pose] of this.released) {
      const actor = this.folderActors.get(id);
      if (!actor) continue;
      this.content.attach(actor.root);
      actor.root.visible = true;
      actor.root.position.copy(pose.position);
      actor.root.rotation.copy(pose.rotation);
      actor.velocity.copy(pose.velocity);
      actor.loose = true;
    }
    // The brass tray displays real prerequisite keys, with paging for a large key ring.
    art.box(this.content, [0.57, 0.04, 0.28], [0.75, 0.875, -0.13], 'brass');
    art.label(
      this.content,
      `KEY RING · ${catalog.keys.length}`,
      '',
      0.45,
      0.065,
      [0.75, 0.932, 0.035],
      { background: '#b58c48', size: 88 },
    );
    catalog.keys.slice(this.session.keyPage * 6, this.session.keyPage * 6 + 6).forEach((key, i) => {
      const object = makeKey(art, key.label, key.waived);
      object.position.set(0.53 + (i % 3) * 0.14, 0.97 + Math.floor(i / 3) * 0.1, -0.11);
      object.scale.setScalar(0.58);
      this.content.add(object);
      this.bind(object, `key:${key.id}`);
      this.keyActors.set(key.id, object);
    });
    if (catalog.keys.length > 6) {
      this.button(
        this.content,
        '< KEYS',
        'office:keys-previous',
        0.55,
        1.13,
        -0.05,
        0.22,
        0.065,
        this.session.keyPage > 0,
      );
      this.button(
        this.content,
        'KEYS >',
        'office:keys-next',
        0.85,
        1.13,
        -0.05,
        0.22,
        0.065,
        (this.session.keyPage + 1) * 6 < catalog.keys.length,
      );
    }
    if (oldHeldKey && catalog.keys.some((key) => key.id === oldHeldKey.id)) {
      let root = this.keyActors.get(oldHeldKey.id);
      if (!root) {
        const key = catalog.keys.find((key) => key.id === oldHeldKey.id)!;
        root = makeKey(art, key.label, key.waived);
        this.content.add(root);
        this.keyActors.set(key.id, root);
      }
      this.heldKey = { ...oldHeldKey, root };
    } else this.heldKey = null;
    // Stamps and physical desk switches give the office useful, memorable affordances.
    const consoleGroup = new THREE.Group();
    consoleGroup.position.set(0.05, 0.91, 0.78);
    consoleGroup.rotation.x = -0.25;
    this.content.add(consoleGroup);
    art.box(consoleGroup, [1.18, 0.22, 0.1], [0, 0, 0], 'teal');
    this.button(
      consoleGroup,
      'X-RAY',
      'office:dependencies',
      -0.4,
      0.045,
      0.065,
      0.32,
      0.065,
      true,
      this.session.xray ? '#99d5d1' : '#e9d6a9',
    );
    this.button(
      consoleGroup,
      'QUICK VIEW',
      'office:quick',
      0,
      0.045,
      0.065,
      0.36,
      0.065,
      true,
      this.session.quickView ? '#99d5d1' : '#e9d6a9',
    );
    this.button(consoleGroup, 'FILE ALL', 'office:file-all', 0.4, 0.045, 0.065, 0.32, 0.065);
    this.button(consoleGroup, 'KEY RING', 'office:unlock', -0.4, -0.045, 0.065, 0.32, 0.065);
    this.button(consoleGroup, 'PIN FILE', 'office:pin', 0, -0.045, 0.065, 0.36, 0.065);
    this.button(
      consoleGroup,
      'PUT DOWN',
      'office:release',
      0.4,
      -0.045,
      0.065,
      0.32,
      0.065,
      !!this.session.held,
    );
    const system = new THREE.Group();
    system.position.set(1.55, 1.18, 0.05);
    system.rotation.y = -0.28;
    this.content.add(system);
    art.box(system, [0.42, 0.52, 0.04], [0, 0, 0], 'wood');
    this.button(system, 'RECENTER', 'recenter', 0, 0.18, 0.04, 0.37, 0.07);
    this.button(system, view.audio ? 'SOUND ON' : 'SOUND OFF', 'audio', 0, 0.06, 0.04, 0.37, 0.07);
    this.button(
      system,
      view.large ? 'TEXT LARGE' : 'TEXT SIZE',
      'large',
      0,
      -0.06,
      0.04,
      0.37,
      0.07,
    );
    this.button(system, 'EXIT VR', 'exit', 0, -0.18, 0.04, 0.37, 0.07);
    const stamp = new THREE.Group();
    this.stamp = stamp;
    stamp.position.set(0.38, 0.88, 0.26);
    this.content.add(stamp);
    art.box(stamp, [0.2, 0.055, 0.12], [0, 0.027, 0], 'dark');
    art.cylinder(stamp, 0.026, 0.044, 0.105, [0, 0.1, 0], 'wood');
    art.box(stamp, [0.14, 0.046, 0.07], [0, 0.166, 0], 'wood');
    const stampLabel = art.label(stamp, 'DONE', '', 0.17, 0.048, [0, 0.035, 0.062], {
      size: 110,
      background: '#ddd0a6',
      color: '#783c29',
    });
    this.bind(stamp, 'office:finish');
    this.bind(stampLabel, 'office:finish');
    const active = activeId ? byId.get(activeId) : undefined;
    const memo = art.label(
      this.content,
      active?.label ?? 'YOUR NEXT FOLDER',
      active
        ? `${active.missingKeys.length ? 'NEEDS ' + active.missingKeys.length + ' KEYS' : 'READY TO WORK'}\n${view.detail}`
        : 'OPEN A DRAWER\nPICK UP A FILE\nFOLLOW THE KEYS',
      0.67,
      0.37,
      [-0.72, 1.3, 0.56],
      { background: '#1d3c31', color: '#c5e5ae', scanlines: true, size: 55 },
    );
    memo.rotation.y = 0.05;
    this.bind(memo, 'office:hold');
    this.button(
      this.content,
      'BACK TO FILE',
      'office:back',
      -0.72,
      1.06,
      0.61,
      0.42,
      0.065,
      this.history.length > 0,
    );
    const clipboard = new THREE.Group();
    clipboard.position.set(-1.5, 1.35, 0.18);
    clipboard.rotation.y = 0.22;
    this.content.add(clipboard);
    art.box(clipboard, [0.46, 0.58, 0.025], [0, 0, 0], 'wood');
    art.label(clipboard, 'FILE INDEX', '', 0.4, 0.065, [0, 0.22, 0.02], { size: 72 });
    view.links.forEach((link, i) =>
      this.button(
        clipboard,
        link.label,
        `folder:${link.id}`,
        0,
        0.11 - i * 0.09,
        0.025,
        0.41,
        0.08,
      ),
    );
    view.context.forEach((action, i) =>
      this.button(
        clipboard,
        action.label,
        action.id,
        ((i % 2) - 0.5) * 0.22,
        -0.1 - Math.floor(i / 2) * 0.08,
        0.025,
        0.21,
        0.065,
        action.enabled,
      ),
    );
    art.label(
      this.content,
      view.message.startsWith('Save issue:') ? view.message : this.session.message,
      '',
      1.3,
      0.16,
      [0.05, 0.69, 1.14],
      {
        size: 43,
        background: '#e8d5a8',
      },
    );
    this.button(
      this.content,
      '< CABINETS',
      'office:cabinets-previous',
      -1.04,
      1.01,
      0.82,
      0.33,
      0.07,
      this.session.cabinetPage > 0,
    );
    this.button(
      this.content,
      'CABINETS >',
      'office:cabinets-next',
      -0.64,
      1.01,
      0.82,
      0.33,
      0.07,
      (this.session.cabinetPage + 1) * 3 < catalog.cabinets.length,
    );
    if (
      (this.session.quickView || this.session.xray) &&
      trace.ids.length > this.session.relatedCapacity + 1
    ) {
      this.button(
        this.content,
        '< FILES',
        'office:quick-previous',
        -0.3,
        2.02,
        0.52,
        0.25,
        0.07,
        this.session.quickPage > 0,
      );
      this.button(
        this.content,
        'FILES >',
        'office:quick-next',
        0.3,
        2.02,
        0.52,
        0.25,
        0.07,
        (this.session.quickPage + 1) * this.session.relatedCapacity < trace.ids.length - 1,
      );
    }
    this.placeHeld();
    this.applyXray(relevant, trace.edges, trace.missing);
  }
  private addFolder(
    id: string,
    parent: THREE.Object3D,
    position: THREE.Vector3,
    remote: boolean,
  ): FolderActor {
    const file = this.view!.catalog.files.find((f) => f.id === id)!;
    const color = fileColor(stateMark(file.node));
    const location =
      this.view!.catalog.cabinets.find((c) => c.id === file.cabinetId)?.label ?? 'Inbox';
    const folder = makeFolder(
      this.dynamicArt,
      file.label,
      `${file.archived ? 'ARCHIVED · ' : ''}${stateMark(file.node).toUpperCase()}\n${remote ? `FILED: ${location}` : file.requiredKeys.length ? `${file.missingKeys.length} MISSING / ${file.requiredKeys.length} KEYS` : 'NO LOCKS'}${this.session.held?.id === id ? '\n' + this.view!.detail : ''}`,
      color,
    );
    folder.position.copy(position);
    folder.name = `file:${id}`;
    parent.add(folder);
    this.bind(folder, `folder:${id}`, id);
    const actor: FolderActor = {
      root: folder,
      home: position.clone(),
      homeRotation: folder.rotation.clone(),
      velocity: new THREE.Vector3(),
      loose: false,
    };
    this.folderActors.set(id, actor);
    if (file.requiredKeys.length) {
      const lock = this.dynamicArt.torus(
        folder,
        0.023,
        0.006,
        [0.162, -0.086, 0.045],
        isSealed(this.session, file) ? 'brass' : 'metal',
      );
      this.bind(lock, `lock:${id}`);
    }
    if (this.session.held?.id === id) {
      this.button(
        folder,
        'DEPENDENCIES',
        'office:dependencies',
        0,
        -0.204,
        0.035,
        0.33,
        0.06,
        true,
        this.session.xray ? '#98d7cd' : '#ecddb8',
      );
      this.button(folder, 'QUICK VIEW', 'office:quick', -0.09, -0.27, 0.035, 0.18, 0.05);
      this.button(folder, 'USE KEYS', `lock:${id}`, 0.105, -0.27, 0.035, 0.18, 0.05, true);
      for (const [index, action] of this.view!.actions.entries())
        if (index < 2)
          this.button(
            folder,
            action.label.toUpperCase(),
            action.id === 'complete' ? 'office:finish' : action.id,
            -0.11 + index * 0.22,
            -0.33,
            0.035,
            0.21,
            0.05,
            action.enabled && !this.view!.busy,
          );
    }
    return actor;
  }
  private placeHeld() {
    const held = this.session.held;
    if (held) {
      const actor = this.folderActors.get(held.id),
        anchor = this.gripRoots.get(held.hand) ?? this.camera;
      if (actor && anchor) {
        anchor.add(actor.root);
        actor.root.visible = true;
        actor.root.scale.setScalar(1);
        actor.root.position.set(
          held.hand === 'desktop' && (this.camera as THREE.PerspectiveCamera).aspect > 1 ? -0.3 : 0,
          held.hand === 'desktop' ? 0.12 : 0.055,
          held.hand === 'desktop' ? -1.02 : -0.08,
        );
        actor.root.rotation.set(
          held.hand === 'desktop' ? -0.06 : 0,
          held.hand === 'desktop' ? 0.08 : 0,
          held.hand === 'desktop' ? 0.03 : 0,
        );
        actor.root.updateWorldMatrix(true, false);
        this.lastHeldPosition.copy(actor.root.getWorldPosition(new THREE.Vector3()));
      }
    }
    if (this.heldKey) {
      const anchor = this.gripRoots.get(this.heldKey.hand) ?? this.camera;
      if (anchor) {
        anchor.add(this.heldKey.root);
        this.heldKey.root.position.set(
          this.heldKey.hand === 'desktop' ? 0.2 : 0,
          this.heldKey.hand === 'desktop' ? -0.11 : 0.03,
          this.heldKey.hand === 'desktop' ? -0.65 : -0.05,
        );
        this.heldKey.root.rotation.set(0, 0, -0.2);
        this.heldKey.root.scale.setScalar(1);
      }
    }
  }
  private applyXray(
    relevant: Set<string>,
    edges: { from: string; to: string }[],
    missing: string[],
  ) {
    const xray = this.session.xray;
    this.shell.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        const mats = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of mats) {
          material.transparent = xray;
          material.opacity = xray ? 0.42 : 1;
          material.depthWrite = true;
        }
      }
    });
    this.root.updateMatrixWorld(true);
    for (const [id, actor] of this.folderActors) {
      if (xray && relevant.has(id)) {
        actor.root.visible = true;
        const outlineBox = this.dynamicArt.own(new THREE.BoxGeometry(0.42, 0.38, 0.05));
        const edge = new THREE.LineSegments(
          this.dynamicArt.own(new THREE.EdgesGeometry(outlineBox)),
          this.dynamicArt.ownMaterial(
            new THREE.LineBasicMaterial({
              color: missing.includes(id) ? '#ffb75e' : '#6ef8df',
              depthTest: false,
              transparent: true,
              opacity: 0.95,
            }),
          ),
        );
        edge.renderOrder = 99;
        edge.layers.set(3);
        actor.root.add(edge);
        actor.root.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            // A second depth buffer pass reveals the whole file through cabinets,
            // while keeping its own cover, paper and label correctly occluded.
            // Three.js reserves layers 1 and 2 for the left/right eyes.
            o.layers.set(3);
          }
        });
      }
    }
    if (xray)
      for (const edge of edges) {
        const a = this.folderActors.get(edge.from),
          b = this.folderActors.get(edge.to);
        if (!a || !b) continue;
        const start = this.root.worldToLocal(a.root.getWorldPosition(new THREE.Vector3())),
          end = this.root.worldToLocal(b.root.getWorldPosition(new THREE.Vector3()));
        const line = new THREE.Line(
          this.dynamicArt.own(new THREE.BufferGeometry().setFromPoints([start, end])),
          this.dynamicArt.ownMaterial(
            new THREE.LineBasicMaterial({
              color: missing.includes(edge.to) ? '#ffb75e' : '#6ef8df',
              depthTest: false,
              transparent: true,
              opacity: 0.8,
            }),
          ),
        );
        line.userData = { from: edge.from, to: edge.to };
        line.renderOrder = 98;
        line.layers.set(3);
        this.traceLines.add(line);
      }
  }
  hover(action: string | null) {
    this.highlight?.removeFromParent();
    this.highlight?.geometry.dispose();
    this.highlight?.material.dispose();
    this.highlight = undefined;
    const target = this.targets.find((t) => t.action === action);
    if (target) {
      this.highlight = new THREE.BoxHelper(target.mesh, '#ffe4a0');
      this.highlight.material.depthTest = false;
      this.highlight.renderOrder = 110;
      // BoxHelper coordinates are world-space. Keep it outside a recentered office root.
      (this.root.parent ?? this.root).add(this.highlight);
    }
  }
  tick(delta: number) {
    this.highlight?.update();
    let moving = false;
    if (this.stamp && this.stampMotion > 0) {
      this.stampMotion = Math.max(0, this.stampMotion - delta * 4);
      this.stamp.position.y = 0.88 - Math.sin(this.stampMotion * Math.PI) * 0.035;
      moving = this.stampMotion > 0;
    }
    for (const drawer of this.drawers.values()) {
      const next = this.motion
        ? THREE.MathUtils.damp(drawer.root.position.z, drawer.goal, 18, delta)
        : drawer.goal;
      if (Math.abs(next - drawer.root.position.z) > 0.0001) moving = true;
      drawer.root.position.z = next;
    }
    for (const [id, actor] of this.folderActors) {
      if (!actor.loose) continue;
      actor.velocity.y -= 9.81 * delta;
      actor.root.position.addScaledVector(actor.velocity, delta);
      const floor = actor.root.position.z < 0.96 ? 0.874 : 0.06;
      if (actor.root.position.y <= floor) {
        actor.root.position.y = floor;
        actor.velocity.y = Math.abs(actor.velocity.y) > 0.3 ? -actor.velocity.y * 0.14 : 0;
        actor.velocity.x *= 0.84;
        actor.velocity.z *= 0.84;
        actor.root.rotation.x = -Math.PI / 2;
      }
      actor.root.position.x = THREE.MathUtils.clamp(actor.root.position.x, -1.4, 1.4);
      actor.root.position.z = THREE.MathUtils.clamp(actor.root.position.z, -0.18, 1.45);
      this.released.set(id, {
        position: actor.root.position.clone(),
        rotation: actor.root.rotation.clone(),
        velocity: actor.velocity.clone(),
      });
      if (actor.velocity.length() > 0.015) moving = true;
    }
    const held = this.session.held ? this.folderActors.get(this.session.held.id) : undefined;
    if (held && delta > 0) {
      const position = held.root.getWorldPosition(new THREE.Vector3());
      if (position.distanceToSquared(this.lastHeldPosition) > 0.000001) moving = true;
      this.handVelocity.copy(position).sub(this.lastHeldPosition).divideScalar(delta);
      this.lastHeldPosition.copy(position);
    }
    const shadowTransforms = new Map<THREE.Object3D, THREE.Matrix4>();
    for (const root of [held?.root, this.heldKey?.root]) {
      if (!root) continue;
      root.updateWorldMatrix(true, false);
      const previous = this.shadowTransforms.get(root);
      if (
        !previous ||
        root.matrixWorld.elements.some(
          (value, i) => Math.abs(value - previous.elements[i]!) > 0.00001,
        )
      )
        moving = true;
      shadowTransforms.set(root, root.matrixWorld.clone());
    }
    this.shadowTransforms = shadowTransforms;
    if (this.session.xray) {
      this.root.updateMatrixWorld(true);
      for (const line of this.traceLines.children) {
        if (!(line instanceof THREE.Line)) continue;
        const a = this.folderActors.get(line.userData.from),
          b = this.folderActors.get(line.userData.to);
        if (a && b) {
          const positions = line.geometry.attributes.position as THREE.BufferAttribute;
          const start = this.root.worldToLocal(a.root.getWorldPosition(new THREE.Vector3())),
            end = this.root.worldToLocal(b.root.getWorldPosition(new THREE.Vector3()));
          positions.setXYZ(0, start.x, start.y, start.z);
          positions.setXYZ(1, end.x, end.y, end.z);
          positions.needsUpdate = true;
          line.geometry.computeBoundingSphere();
        }
      }
    }
    return moving;
  }
  dispose() {
    this.detective.dispose();
    this.calendar.dispose();
    this.clearDynamic();
    this.staticArt.dispose();
    this.root.removeFromParent();
  }
}
