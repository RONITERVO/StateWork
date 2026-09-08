import * as THREE from 'three';
import type { SemanticNode } from '@statework/sdk';
import { OfficeWorld } from './office-world';
import type { OfficeFeedback, OfficeTarget } from './office-world';
import type { OfficeCatalog, OfficeHand } from './office-model';

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
  catalog: OfficeCatalog;
}
function visible(object: THREE.Object3D) {
  for (let node: THREE.Object3D | null = object; node; node = node.parent)
    if (!node.visible) return false;
  return true;
}
export function pickAction(ray: THREE.Raycaster, targets: readonly OfficeTarget[]): string | null {
  const available = targets.filter((target) => visible(target.mesh));
  // X-ray is drawn after the room with a fresh depth buffer; picking follows
  // that same visual priority instead of intercepting a revealed file with a drawer.
  const overlay = available.filter((target) => target.mesh.layers.isEnabled(3));
  const hit =
    ray.intersectObjects(
      overlay.map((target) => target.mesh),
      false,
    )[0] ??
    ray.intersectObjects(
      available.map((target) => target.mesh),
      false,
    )[0];
  return hit ? (available.find((target) => target.mesh === hit.object)?.action ?? null) : null;
}
const home = new THREE.Vector3(0, 1.58, 2.32);

export class SpatialScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(57, 1, 0.035, 35);
  private office: OfficeWorld;
  private ray = new THREE.Raycaster();
  private controllers: {
    ray: THREE.XRTargetRaySpace;
    grip: THREE.XRGripSpace;
    hand: OfficeHand;
    cursor: THREE.Mesh;
  }[] = [];
  private resize: ResizeObserver;
  private session: XRSession | null = null;
  private entering = false;
  private disposed = false;
  private recenterPending = false;
  private animation: number | null = null;
  private lastFrame = 0;
  private framesRemaining = 0;
  private dragging: { x: number; y: number } | null = null;
  private yaw = 0;
  private pitch = -0.1;
  private lastAction: string | null = null;

  constructor(
    private host: HTMLElement,
    private act: (id: string) => void,
    private sessionChanged: (active: boolean) => void,
    private report: (message: string) => void,
    private officeChanged?: (feedback: OfficeFeedback) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.xr.enabled = true;
    this.renderer.xr.setReferenceSpaceType('local');
    this.scene.background = new THREE.Color('#a5afa0');
    this.scene.fog = new THREE.Fog('#a5afa0', 8, 19);
    this.camera.position.copy(home);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.x = this.pitch;
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight('#eee9d6', '#625342', 2.1));
    const sun = new THREE.DirectionalLight('#ffdfad', 3.1);
    sun.position.set(-3.2, 4.5, 2.8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -5;
    sun.shadow.camera.right = 5;
    sun.shadow.camera.top = 5;
    sun.shadow.camera.bottom = -5;
    sun.shadow.normalBias = 0.025;
    sun.shadow.bias = -0.00015;
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight('#c6dbda', 0.8);
    fill.position.set(3, 2, 1);
    this.scene.add(fill);
    this.scene.traverse((object) => {
      if (object instanceof THREE.Light) object.layers.enableAll();
    });
    this.renderer.shadowMap.autoUpdate = false;
    this.office = new OfficeWorld(
      (id) => this.perform(id),
      (feedback) => {
        this.officeChanged?.(feedback);
        this.invalidate();
      },
    );
    this.scene.add(this.office.root);
    const canvas = this.renderer.domElement;
    canvas.setAttribute('aria-hidden', 'true');
    host.append(canvas);
    canvas.addEventListener('click', this.onClick);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('contextmenu', this.onContextMenu);
    canvas.addEventListener('pointerleave', this.onLeave);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    this.resize = new ResizeObserver(() => this.resizeCanvas());
    this.resize.observe(host);
    for (let i = 0; i < 2; i++) {
      const ray = this.renderer.xr.getController(i),
        grip = this.renderer.xr.getControllerGrip(i);
      const cursor = new THREE.Mesh(
        new THREE.SphereGeometry(0.007, 8, 6),
        new THREE.MeshBasicMaterial({ color: '#f3d183', depthTest: false }),
      );
      cursor.visible = false;
      this.scene.add(cursor);
      const controller = { ray, grip, hand: (i === 0 ? 'left' : 'right') as OfficeHand, cursor };
      this.controllers.push(controller);
      const laser = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(),
          new THREE.Vector3(0, 0, -5),
        ]),
        new THREE.LineBasicMaterial({ color: '#d6bc77', transparent: true, opacity: 0.45 }),
      );
      ray.add(laser);
      // Original neutral grip silhouette, no remote controller-model fetch.
      const palm = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.029, 0.075, 4, 8),
        new THREE.MeshStandardMaterial({ color: '#516c64', roughness: 0.7 }),
      );
      palm.rotation.x = Math.PI / 2;
      grip.add(palm);
      this.scene.add(ray, grip);
      ray.addEventListener('connected', (event) => {
        controller.hand = event.data.handedness === 'right' ? 'right' : 'left';
        this.bindHands();
      });
      ray.addEventListener('disconnected', () => {
        this.office.returnHeldFromLostTracking(controller.hand);
        cursor.visible = false;
      });
      ray.addEventListener('select', () => {
        if (this.session?.visibilityState !== 'visible' || !ray.visible) return;
        this.scene.updateMatrixWorld(true);
        const action = this.controllerAction(ray, controller.hand);
        if (action) this.perform(action, controller.hand);
      });
      ray.addEventListener('squeezestart', () => {
        if (this.session?.visibilityState !== 'visible' || !grip.visible) return;
        this.scene.updateMatrixWorld(true);
        if (!this.office.grabNearest(grip.getWorldPosition(new THREE.Vector3()), controller.hand)) {
          const action = this.controllerAction(ray, controller.hand);
          if (action?.startsWith('folder:') || action?.startsWith('key:'))
            this.perform(action, controller.hand);
        }
      });
      ray.addEventListener('squeezeend', () => {
        this.office.release(controller.hand);
        this.invalidate();
      });
    }
    this.bindHands();
    this.resizeCanvas();
  }
  private bindHands() {
    this.office.setHands(this.camera, new Map(this.controllers.map((c) => [c.hand, c.grip])));
  }
  get officeFeedback() {
    return this.office.feedback;
  }
  officeAction(action: string) {
    this.perform(action);
  }
  inspect(id: string) {
    this.office.inspect(id);
    this.invalidate();
  }
  private perform(id: string, hand: OfficeHand = 'desktop') {
    if (this.office.action(id, hand)) {
      this.invalidate();
      return;
    }
    this.act(id);
    this.invalidate();
  }
  async supported() {
    return Boolean(
      isSecureContext && navigator.xr && (await navigator.xr.isSessionSupported('immersive-vr')),
    );
  }
  async enter() {
    if (this.session || this.entering || this.disposed) return;
    if (!navigator.xr)
      throw new Error(
        'WebXR is unavailable here. The desktop office and work controls remain usable.',
      );
    this.entering = true;
    let requested: XRSession | undefined;
    try {
      requested = await navigator.xr.requestSession('immersive-vr', {
        requiredFeatures: ['local'],
      });
      if (this.disposed) {
        await requested.end();
        return;
      }
      this.session = requested;
      this.office.setImmersive(true);
      this.recenterPending = true;
      requested.addEventListener('end', this.onSessionEnd, { once: true });
      requested.addEventListener('visibilitychange', () => {
        if (requested?.visibilityState !== 'visible') {
          for (const c of this.controllers) this.office.returnHeldFromLostTracking(c.hand);
        }
      });
      if (this.animation !== null) {
        cancelAnimationFrame(this.animation);
        this.animation = null;
      }
      await this.renderer.xr.setSession(requested);
      this.sessionChanged(true);
      this.lastFrame = 0;
      this.renderer.setAnimationLoop((time, frame) => {
        if (!frame || this.session?.visibilityState !== 'visible') return;
        if (this.recenterPending) {
          const reference = this.renderer.xr.getReferenceSpace(),
            pose = reference ? frame.getViewerPose(reference) : null;
          if (pose) {
            const { position, orientation } = pose.transform;
            const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(
              new THREE.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w),
            );
            const yaw = Math.atan2(-facing.x, -facing.z);
            this.office.root.rotation.set(0, yaw, 0);
            const offset = home.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
            this.office.root.position.set(
              position.x - offset.x,
              position.y - offset.y,
              position.z - offset.z,
            );
            this.recenterPending = false;
          }
        }
        const delta = this.lastFrame ? Math.min((time - this.lastFrame) / 1000, 0.035) : 1 / 90;
        this.lastFrame = time;
        this.scene.updateMatrixWorld(true);
        this.office.tick(delta);
        for (const c of this.controllers) {
          const action = c.ray.visible ? this.controllerAction(c.ray, c.hand) : null;
          c.cursor.visible = !!action;
          if (action) {
            const hit = this.ray.intersectObjects(
              this.office
                .targetsFor(c.hand)
                .filter((t) => visible(t.mesh))
                .map((t) => t.mesh),
              false,
            )[0];
            if (hit) c.cursor.position.copy(hit.point);
          }
        }
        this.renderOffice();
      });
    } catch (error) {
      if (requested) await requested.end().catch(() => undefined);
      this.onSessionEnd();
      throw error;
    } finally {
      this.entering = false;
    }
  }
  async exit() {
    await this.session?.end();
  }
  private onSessionEnd = () => {
    this.session = null;
    this.renderer.setAnimationLoop(null);
    queueMicrotask(() => {
      if (this.disposed) return;
      for (const c of this.controllers) {
        this.office.returnHeldFromLostTracking(c.hand);
        c.cursor.visible = false;
      }
      this.office.root.position.set(0, 0, 0);
      this.office.root.rotation.set(0, 0, 0);
      this.office.setImmersive(false);
      this.camera.position.copy(home);
      this.look('desk');
      this.sessionChanged(false);
      this.resizeCanvas();
    });
  };
  recenter() {
    if (this.session) this.recenterPending = true;
    else this.look('desk');
  }
  look(direction: 'left' | 'right' | 'desk' | 'files') {
    if (this.session) return;
    this.yaw = direction === 'left' ? 0.5 : direction === 'right' ? -0.5 : 0;
    this.pitch = direction === 'files' ? 0.05 : -0.1;
    this.camera.position.copy(home);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.invalidate();
  }
  update(view: SpatialView) {
    this.office.update(view);
    this.invalidate();
  }
  private invalidate() {
    if (this.disposed || this.session) return;
    // Procedural textures are ready synchronously. Two frames cover resize and
    // hover updates; tick() keeps the loop alive for actual moving objects.
    this.framesRemaining = 2;
    if (this.animation === null) this.animation = requestAnimationFrame(this.desktopFrame);
  }
  private desktopFrame = (time: number) => {
    this.animation = null;
    if (this.disposed || this.session) return;
    const delta = this.lastFrame ? Math.min((time - this.lastFrame) / 1000, 0.035) : 1 / 60;
    this.lastFrame = time;
    this.scene.updateMatrixWorld(true);
    const moving = this.office.tick(delta);
    this.renderOffice();
    if (moving || --this.framesRemaining > 0)
      this.animation = requestAnimationFrame(this.desktopFrame);
  };
  private resizeCanvas() {
    if (this.session || this.disposed) return;
    const { width, height } = this.host.getBoundingClientRect();
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.fov = width < 600 ? 72 : 57;
    this.camera.updateProjectionMatrix();
    this.bindHands();
    this.invalidate();
  }
  private recordRender() {
    const canvas = this.renderer.domElement;
    canvas.dataset.drawCalls = String(this.renderer.info.render.calls);
    canvas.dataset.triangles = String(this.renderer.info.render.triangles);
    canvas.dataset.geometries = String(this.renderer.info.memory.geometries);
    canvas.dataset.textures = String(this.renderer.info.memory.textures);
    canvas.dataset.immersive = String(!!this.session);
  }
  private renderOffice() {
    this.renderer.shadowMap.needsUpdate = true;
    this.camera.layers.set(0);
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
    if (this.office.feedback.xray) {
      this.renderer.autoClear = false;
      const background = this.scene.background;
      this.scene.background = null;
      this.renderer.clearDepth();
      this.camera.layers.set(3);
      this.renderer.render(this.scene, this.camera);
      this.camera.layers.set(0);
      this.scene.background = background;
      this.renderer.autoClear = true;
    }
    this.recordRender();
  }
  private pointerAction(event: MouseEvent) {
    this.ray.layers.enableAll();
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.scene.updateMatrixWorld(true);
    this.ray.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    return pickAction(this.ray, this.office.targets);
  }
  private controllerAction(controller: THREE.Object3D, hand: OfficeHand) {
    this.ray.layers.enableAll();
    this.ray.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this.ray.ray.direction.set(0, 0, -1).transformDirection(controller.matrixWorld);
    return pickAction(this.ray, this.office.targetsFor(hand));
  }
  private onClick = (event: MouseEvent) => {
    if (this.session || event.button !== 0) return;
    const action = this.pointerAction(event);
    if (action) this.perform(action);
  };
  private onPointerDown = (event: PointerEvent) => {
    if (event.button === 2 && !this.session) {
      this.dragging = { x: event.clientX, y: event.clientY };
      this.renderer.domElement.setPointerCapture(event.pointerId);
    }
  };
  private onPointerUp = (event: PointerEvent) => {
    this.dragging = null;
    if (this.renderer.domElement.hasPointerCapture(event.pointerId))
      this.renderer.domElement.releasePointerCapture(event.pointerId);
  };
  private onPointerMove = (event: PointerEvent) => {
    if (this.session) return;
    if (this.dragging) {
      this.yaw = THREE.MathUtils.clamp(
        this.yaw - (event.clientX - this.dragging.x) * 0.003,
        -0.8,
        0.8,
      );
      this.pitch = THREE.MathUtils.clamp(
        this.pitch - (event.clientY - this.dragging.y) * 0.003,
        -0.45,
        0.35,
      );
      this.dragging = { x: event.clientX, y: event.clientY };
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      this.invalidate();
      return;
    }
    const action = this.pointerAction(event);
    this.renderer.domElement.style.cursor = action ? 'pointer' : 'grab';
    if (action !== this.lastAction) {
      this.lastAction = action;
      this.office.hover(action);
      this.invalidate();
    }
  };
  private onLeave = () => {
    this.lastAction = null;
    this.office.hover(null);
  };
  private onContextMenu = (event: Event) => event.preventDefault();
  private onContextLost = (event: Event) => {
    event.preventDefault();
    void this.exit().catch(() => undefined);
    this.report(
      'The 3D view paused. Your records are safe. Use the work buttons or reload the office.',
    );
  };
  private onContextRestored = () => this.invalidate();
  dispose() {
    this.disposed = true;
    this.resize.disconnect();
    if (this.animation !== null) cancelAnimationFrame(this.animation);
    this.renderer.setAnimationLoop(null);
    if (this.session) {
      this.session.removeEventListener('end', this.onSessionEnd);
      void this.session.end().catch(() => undefined);
    }
    this.office.dispose();
    for (const c of this.controllers) {
      c.ray.traverse((o) => {
        if (o instanceof THREE.Line) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      c.grip.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      c.cursor.geometry.dispose();
      (c.cursor.material as THREE.Material).dispose();
    }
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
