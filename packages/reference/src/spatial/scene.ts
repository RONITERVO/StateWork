import * as THREE from 'three';
import { arcSlot, marks, stateMark } from './model';
import type { SemanticNode } from '@statework/sdk';

export interface SpatialView {
  title: string;
  nodes: SemanticNode[];
  selected?: SemanticNode;
  detail: string;
  links: { id: string; label: string }[];
  actions: { id: string; label: string; enabled: boolean }[];
  context: { id: string; label: string; enabled: boolean }[];
  pageLabel: string;
  previous: boolean;
  next: boolean;
  message: string;
  busy: boolean;
  large: boolean;
  audio: boolean;
}
interface Target {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  action: string;
}

/** Pure input binding shared by mouse picking and WebXR select events. */
export function pickAction(ray: THREE.Raycaster, targets: readonly Target[]): string | null {
  const hit = ray.intersectObjects(
    targets.map((t) => t.mesh),
    false,
  )[0];
  return hit ? (targets.find((t) => t.mesh === hit.object)?.action ?? null) : null;
}

/** Original geometry only. No remote models, fonts, textures, tracking or locomotion. */
export class SpatialScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(50, 1, 0.05, 40);
  private room = new THREE.Group();
  private content = new THREE.Group();
  private ray = new THREE.Raycaster();
  private targets: Target[] = [];
  private controllers: THREE.XRTargetRaySpace[] = [];
  private hover = new Set<string>();
  private resize: ResizeObserver;
  private session: XRSession | null = null;
  private entering = false;
  private recenterPending = false;
  private view?: SpatialView;
  private disposed = false;

  constructor(
    private host: HTMLElement,
    private act: (id: string) => void,
    private sessionChanged: (active: boolean) => void,
    private report: (message: string) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.xr.enabled = true;
    // Eye-relative local space supports sitting without assuming a person's height.
    this.renderer.xr.setReferenceSpaceType('local');
    this.renderer.xr.setFramebufferScaleFactor(1);
    this.renderer.setClearColor(0x101722, 0);
    this.camera.position.set(0, 0, 1.2);
    this.scene.add(this.room);
    this.room.add(this.content);
    const canvas = this.renderer.domElement;
    canvas.setAttribute('aria-hidden', 'true');
    host.append(canvas);
    canvas.addEventListener('click', this.onClick);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    this.resize = new ResizeObserver(() => this.resizeCanvas());
    this.resize.observe(host);
    for (let i = 0; i < 2; i++) {
      const controller = this.renderer.xr.getController(i);
      controller.addEventListener('select', () => {
        if (this.session?.visibilityState !== 'visible' || !controller.visible) return;
        const action = this.controllerAction(controller);
        if (action) this.act(action);
      });
      const laser = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(0, 0, 0),
          new THREE.Vector3(0, 0, -4),
        ]),
        new THREE.LineBasicMaterial({ color: 0x9fe2c7, transparent: true, opacity: 0.65 }),
      );
      controller.add(laser);
      this.scene.add(controller);
      this.controllers.push(controller);
    }
    this.resizeCanvas();
  }

  async supported(): Promise<boolean> {
    return Boolean(
      window.isSecureContext &&
        navigator.xr &&
        (await navigator.xr.isSessionSupported('immersive-vr')),
    );
  }
  async enter() {
    if (this.session || this.entering || this.disposed) return;
    if (!navigator.xr)
      throw new Error('This browser has no WebXR support. Use the work buttons below.');
    this.entering = true;
    let requested: XRSession | undefined;
    try {
      // Must be called from the user's click. Do not await another operation first.
      requested = await navigator.xr.requestSession('immersive-vr', {
        requiredFeatures: ['local'],
      });
      if (this.disposed) {
        await requested.end();
        return;
      }
      this.session = requested;
      this.scene.background = new THREE.Color('#101722');
      requested.addEventListener('end', this.onSessionEnd, { once: true });
      this.recenterPending = true;
      await this.renderer.xr.setSession(requested);
      this.sessionChanged(true);
      this.renderer.setAnimationLoop((_time, frame) => {
        if (!frame || this.session?.visibilityState !== 'visible') return;
        if (this.recenterPending) {
          const space = this.renderer.xr.getReferenceSpace();
          const pose = space ? frame.getViewerPose(space) : null;
          if (pose) {
            const { position, orientation } = pose.transform;
            const direction = new THREE.Vector3(0, 0, -1).applyQuaternion(
              new THREE.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w),
            );
            this.room.position.set(position.x, position.y, position.z);
            this.room.rotation.set(0, Math.atan2(-direction.x, -direction.z), 0);
            this.recenterPending = false;
          }
        }
        this.scene.updateMatrixWorld(true);
        this.highlight(
          this.controllers
            .filter((c) => c.visible)
            .map((c) => this.controllerAction(c))
            .filter((a): a is string => !!a),
        );
        this.renderer.render(this.scene, this.camera);
      });
    } catch (e) {
      if (requested) await requested.end().catch(() => undefined);
      this.session = null;
      this.onSessionEnd();
      throw e;
    } finally {
      this.entering = false;
    }
  }
  async exit() {
    await this.session?.end();
  }
  recenter() {
    if (this.session) this.recenterPending = true;
    else {
      this.room.position.set(0, 0, 0);
      this.room.rotation.set(0, 0, 0);
      this.draw();
    }
  }
  private onSessionEnd = () => {
    this.session = null;
    this.renderer.setAnimationLoop(null);
    // Three's end listener restores the framebuffer. Resize only after that listener runs.
    queueMicrotask(() => {
      if (this.disposed) return;
      this.scene.background = null;
      this.room.position.set(0, 0, 0);
      this.room.rotation.set(0, 0, 0);
      this.camera.position.set(0, 0, 1.2);
      this.camera.quaternion.identity();
      this.hover.clear();
      this.sessionChanged(false);
      this.resizeCanvas();
    });
  };
  private onContextLost = (event: Event) => {
    event.preventDefault();
    void this.exit().catch(() => undefined);
    this.report(
      '3D paused: graphics context lost. Your work is saved. Use the work buttons below, or reload to restore 3D.',
    );
  };
  private onContextRestored = () => {
    if (this.view) this.update(this.view);
  };
  private resizeCanvas() {
    if (this.session || this.disposed) return;
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    // Keep the whole arc in view on a narrow phone without introducing camera movement.
    this.camera.fov = width < height * 1.5 ? 66 : 50;
    this.camera.updateProjectionMatrix();
    this.draw();
  }
  private draw() {
    if (!this.session && !this.disposed) this.renderer.render(this.scene, this.camera);
  }
  private pointerAction(event: MouseEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.scene.updateMatrixWorld(true);
    this.ray.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    return pickAction(this.ray, this.targets);
  }
  private onClick = (event: MouseEvent) => {
    if (!this.session) {
      const action = this.pointerAction(event);
      if (action) this.act(action);
    }
  };
  private onMove = (event: PointerEvent) => {
    if (this.session) return;
    const action = this.pointerAction(event);
    this.renderer.domElement.style.cursor = action ? 'pointer' : 'default';
    this.highlight(action ? [action] : []);
    this.draw();
  };
  private onLeave = () => {
    this.highlight([]);
    this.draw();
  };
  private controllerAction(controller: THREE.Object3D) {
    this.ray.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this.ray.ray.direction.set(0, 0, -1).transformDirection(controller.matrixWorld);
    return pickAction(this.ray, this.targets);
  }
  private highlight(actions: string[]) {
    const next = new Set(actions);
    if (next.size === this.hover.size && [...next].every((a) => this.hover.has(a))) return;
    this.hover = next;
    for (const t of this.targets)
      t.mesh.material.color.set(next.has(t.action) ? '#ffffff' : '#d1dbea');
  }

  update(view: SpatialView) {
    this.view = view;
    this.clearContent();
    this.hover.clear();
    const selected = view.selected;
    const scale = view.large ? 1.18 : 1;
    this.panel({
      x: 0,
      y: 1.08,
      z: -2.5,
      width: 1.56,
      height: 0.22,
      title: view.title,
      color: '#9fe2c7',
    });
    view.nodes.forEach((node, i) => {
      const left = i < 3;
      const slot = arcSlot(left ? 0 : 2, 3, 2.65);
      // Two columns with three rows; both remain in the forward hemisphere.
      const x = slot.x * 1.65;
      this.panel({
        x,
        y: 0.68 - (i % 3) * 0.57,
        z: slot.z,
        yaw: slot.yaw,
        width: 1.02,
        height: 0.48,
        title: node.label,
        subtitle: `${marks[stateMark(node)].symbol} ${marks[stateMark(node)].label}`,
        color: marks[stateMark(node)].color,
        action: view.busy ? undefined : `select:${node.id}`,
        selected: selected?.id === node.id,
        scale,
      });
      if (selected?.relationships.some((r) => r.targetId === node.id)) {
        const points = [
          new THREE.Vector3(0, 0.45, -2.58),
          new THREE.Vector3(x, 0.68 - (i % 3) * 0.57, slot.z - 0.08),
        ];
        const line = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({ color: '#617e85' }),
        );
        this.content.add(line);
      }
    });
    this.panel({
      x: 0,
      y: 0.5,
      z: -2.48,
      width: 1.4,
      height: 0.8,
      title: selected?.label ?? 'Choose a step',
      subtitle: selected
        ? `${marks[stateMark(selected)].symbol} ${marks[stateMark(selected)].label}\n${view.detail}`
        : 'Select a card.\nPoint + trigger, or use the buttons below.',
      color: selected ? marks[stateMark(selected)].color : '#9fc5ff',
      selected: true,
      scale,
    });
    view.actions.slice(0, 2).forEach((action, i) =>
      this.panel({
        x: -0.36 + i * 0.72,
        y: -0.09,
        z: -2.48,
        width: 0.67,
        height: 0.23,
        title: action.label,
        color: action.enabled ? '#9fe2c7' : '#b1b8ca',
        action: !view.busy && action.enabled ? action.id : undefined,
      }),
    );
    view.links.slice(0, 2).forEach((link, i) =>
      this.panel({
        x: 0,
        y: -0.4 - i * 0.22,
        z: -2.48,
        width: 1.4,
        height: 0.19,
        title: link.label,
        color: '#ffd19a',
        action: view.busy ? undefined : `select:${link.id}`,
      }),
    );
    view.context.slice(0, 4).forEach((action, i) =>
      this.panel({
        x: (i - (view.context.length - 1) / 2) * 0.48,
        y: -0.88,
        z: -2.48,
        width: 0.44,
        height: 0.2,
        title: action.label,
        color: action.enabled ? '#adcfff' : '#8a95a6',
        action: action.enabled && !view.busy ? action.id : undefined,
      }),
    );
    const controls = [
      { label: '‹ Page', id: 'previous', enabled: view.previous },
      { label: 'Next ›', id: 'next', enabled: view.next },
      { label: 'Recenter', id: 'recenter', enabled: true },
      { label: view.audio ? 'Sound on' : 'Sound off', id: 'audio', enabled: true },
      { label: 'Exit VR', id: 'exit', enabled: true },
    ];
    controls.forEach((c, i) =>
      this.panel({
        x: (i - 2) * 0.64,
        y: -1.17,
        z: -2.7,
        width: 0.59,
        height: 0.23,
        title: c.label,
        color: c.enabled ? '#adcfff' : '#8a95a6',
        action: c.enabled && !view.busy ? c.id : undefined,
      }),
    );
    this.panel({
      x: 0,
      y: -1.4,
      z: -2.7,
      width: 3.1,
      height: 0.18,
      title: view.busy
        ? 'Saving…'
        : view.message || `${view.pageLabel}  ·  Point + trigger to select`,
      color: '#b1b8ca',
    });
    this.draw();
  }
  private panel(p: {
    x: number;
    y: number;
    z: number;
    width: number;
    height: number;
    yaw?: number;
    title: string;
    subtitle?: string;
    color: string;
    action?: string;
    selected?: boolean;
    scale?: number;
  }) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(p.width * 650);
    canvas.height = Math.round(p.height * 650);
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width,
      h = canvas.height;
    ctx.fillStyle = p.selected ? '#21372f' : '#1c2736';
    ctx.strokeStyle = p.selected ? '#9fe2c7' : '#49586e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.roundRect(2, 2, w - 4, h - 4, 18);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = p.color;
    ctx.fillRect(18, 18, 5, h - 36);
    const small = p.height < 0.3;
    const font = Math.round((small ? 30 : 36) * (p.scale ?? 1));
    ctx.font = `600 ${font}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#f0f5fc';
    let y = small ? (h - font) / 2 : 23;
    const titleLines = this.wrap(ctx, p.title, w - 65, small ? 1 : 2);
    for (const line of titleLines) {
      ctx.fillText(line, 36, y);
      y += font * 1.18;
    }
    if (p.subtitle) {
      y += 16;
      ctx.fillStyle = p.color;
      ctx.font = `400 ${Math.round(27 * (p.scale ?? 1))}px system-ui, sans-serif`;
      for (const line of this.wrap(
        ctx,
        p.subtitle,
        w - 65,
        Math.max(1, Math.floor((h - y - 12) / (34 * (p.scale ?? 1)))),
      )) {
        ctx.fillText(line, 36, y);
        y += 34 * (p.scale ?? 1);
      }
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(p.width, p.height),
      new THREE.MeshBasicMaterial({ map: texture, color: '#d1dbea', side: THREE.DoubleSide }),
    );
    mesh.position.set(p.x, p.y, p.z);
    mesh.rotation.y = p.yaw ?? 0;
    this.content.add(mesh);
    if (p.action) this.targets.push({ mesh, action: p.action });
  }
  private wrap(ctx: CanvasRenderingContext2D, text: string, width: number, maxLines: number) {
    const lines: string[] = [];
    for (const paragraph of text.split('\n')) {
      let line = '';
      // Character iteration handles long unbroken names and scripts without spaces.
      for (const char of paragraph) {
        if (ctx.measureText(line + char).width > width && line) {
          lines.push(line.trim());
          line = '';
        }
        line += char;
      }
      if (line) lines.push(line.trim());
    }
    if (lines.length > maxLines) {
      const line = lines[maxLines - 1] ?? '';
      lines[maxLines - 1] = `${line.slice(0, -2)}…`;
    }
    return lines.slice(0, maxLines);
  }
  private clearContent() {
    for (const child of [...this.content.children]) {
      this.content.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        child.material.map?.dispose();
        child.material.dispose();
      }
      if (child instanceof THREE.Line) {
        child.geometry.dispose();
        child.material.dispose();
      }
    }
    this.targets = [];
  }
  dispose() {
    this.disposed = true;
    this.resize.disconnect();
    this.renderer.setAnimationLoop(null);
    if (this.session) {
      this.session.removeEventListener('end', this.onSessionEnd);
      void this.session.end().catch(() => undefined);
    }
    this.clearContent();
    for (const c of this.controllers)
      c.traverse((o) => {
        if (o instanceof THREE.Line) {
          o.geometry.dispose();
          o.material.dispose();
        }
      });
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('click', this.onClick);
    canvas.removeEventListener('pointermove', this.onMove);
    canvas.removeEventListener('pointerleave', this.onLeave);
    canvas.removeEventListener('webglcontextlost', this.onContextLost);
    canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.renderer.dispose();
    canvas.remove();
  }
}
