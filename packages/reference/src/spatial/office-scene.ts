import * as THREE from 'three';
import type { SemanticNode } from '@statework/sdk';
import { OfficeWorld } from './office-world';
import type { OfficeFeedback, OfficeTarget } from './office-world';
import type { OfficeCatalog, OfficeHand } from './office-model';
import type { DetectiveView } from './detective-board';
import type { CalendarView } from './calendar';
import type { PacketDeskView } from './packet-view';
import { moveInOffice, officeLayout, snapTurn, stickVector } from './office-layout';
import type { RoomPoint } from './office-layout';

export interface SpatialView {
  board?: DetectiveView;
  calendar?: CalendarView;
  packet?: PacketDeskView;
  movement?: boolean;
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
  private rig = new THREE.Group();
  private camera = new THREE.PerspectiveCamera(57, 1, 0.035, 35);
  private office: OfficeWorld;
  private ray = new THREE.Raycaster();
  private controllers: {
    ray: THREE.XRTargetRaySpace;
    grip: THREE.XRGripSpace;
    hand: OfficeHand;
    cursor: THREE.Mesh;
    source: XRInputSource | null;
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
  private shadowDirty = true;
  private pressed = new Set<string>();
  private walking = true;
  private turnArmed = true;
  private xrNeedsNeutral = true;

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
    this.scene.add(this.rig);
    this.rig.add(this.camera);
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
    this.office.root.add(sun, sun.target, fill, fill.target);
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
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.stopMovement);
    document.addEventListener('visibilitychange', this.onPageVisibility);
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
      const controller = {
        ray,
        grip,
        hand: (i === 0 ? 'left' : 'right') as OfficeHand,
        cursor,
        source: null as XRInputSource | null,
      };
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
      this.rig.add(ray, grip);
      ray.addEventListener('connected', (event) => {
        controller.source = event.data;
        this.xrNeedsNeutral = true;
        controller.hand = event.data.handedness === 'right' ? 'right' : 'left';
        this.bindHands();
      });
      ray.addEventListener('disconnected', () => {
        controller.source = null;
        this.xrNeedsNeutral = true;
        this.turnArmed = true;
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
      this.stopMovement();
      this.rig.position.set(0, 0, 0);
      this.rig.rotation.set(0, 0, 0);
      this.office.setImmersive(true);
      this.recenterPending = true;
      requested.addEventListener('end', this.onSessionEnd, { once: true });
      requested.addEventListener('visibilitychange', () => {
        if (requested?.visibilityState !== 'visible') {
          this.stopMovement();
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
            this.shadowDirty = true;
          }
        }
        const delta = this.lastFrame ? Math.min((time - this.lastFrame) / 1000, 0.035) : 1 / 90;
        this.lastFrame = time;
        this.moveXR(Math.min(delta, 0.1));
        this.scene.updateMatrixWorld(true);
        const moving = this.office.tick(delta);
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
        this.renderOffice(moving);
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
    this.stopMovement();
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
      this.rig.position.set(0, 0, 0);
      this.rig.rotation.set(0, 0, 0);
      this.office.setImmersive(false);
      this.camera.position.copy(home);
      this.look('desk');
      this.sessionChanged(false);
      this.resizeCanvas();
    });
  };
  recenter() {
    this.stopMovement();
    this.shadowDirty = true;
    if (this.session) {
      this.rig.position.set(0, 0, 0);
      this.rig.rotation.set(0, 0, 0);
      this.recenterPending = true;
    } else this.look('desk');
  }
  look(direction: 'left' | 'right' | 'desk' | 'files' | 'board' | 'calendar') {
    if (direction === 'board' || direction === 'calendar') {
      this.navigate(direction);
      return;
    }
    if (this.session) {
      if (direction === 'desk') this.navigate('desk');
      return;
    }
    if (direction === 'left' || direction === 'right')
      this.yaw += direction === 'left' ? Math.PI / 4 : -Math.PI / 4;
    else {
      this.yaw = 0;
      this.pitch = direction === 'files' ? 0.05 : -0.1;
      this.camera.position.copy(home);
    }
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    this.invalidate();
  }
  update(view: SpatialView) {
    this.renderer.domElement.dataset.packetOpen = String(view.packet?.open ?? false);
    this.renderer.domElement.dataset.packetPage = String(view.packet?.page ?? 0);
    this.renderer.domElement.dataset.packetStep = String(view.packet?.step ?? 0);
    this.walking = view.movement !== false;
    if (!this.walking) this.stopMovement();
    this.office.update(view);
    this.invalidate();
  }
  private invalidate() {
    this.shadowDirty = true;
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
    const moved = this.moveDesktop(delta);
    if (moving || moved || this.framesRemaining > 0) this.renderOffice(moving);
    if (this.pressed.size || moving || --this.framesRemaining > 0)
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
    const point = this.roomPosition();
    canvas.dataset.roomPosition = `${point.x.toFixed(3)},${point.z.toFixed(3)}`;
    canvas.dataset.roomYaw = this.roomYaw().toFixed(3);
    canvas.dataset.movement = String(this.walking);
  }
  private renderOffice(moving: boolean) {
    this.renderer.shadowMap.needsUpdate = this.shadowDirty || moving;
    this.shadowDirty = false;
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
      this.yaw -= (event.clientX - this.dragging.x) * 0.003;
      this.pitch = THREE.MathUtils.clamp(
        this.pitch - (event.clientY - this.dragging.y) * 0.003,
        -1.15,
        1.15,
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
    this.stopMovement();
    void this.exit().catch(() => undefined);
    this.report(
      'The 3D view paused. Your records are safe. Use the work buttons or reload the office.',
    );
  };
  private onContextRestored = () => this.invalidate();
  private roomPosition(): RoomPoint {
    const camera = this.session ? this.renderer.xr.getCamera() : this.camera;
    const point = this.office.root.worldToLocal(camera.getWorldPosition(new THREE.Vector3()));
    return { x: point.x, z: point.z };
  }
  private roomYaw() {
    if (!this.session) return this.yaw;
    const rotation = this.renderer.xr.getCamera().getWorldQuaternion(new THREE.Quaternion());
    const facing = new THREE.Vector3(0, 0, -1)
      .applyQuaternion(rotation)
      .applyQuaternion(this.office.root.getWorldQuaternion(new THREE.Quaternion()).invert());
    return Math.atan2(-facing.x, -facing.z);
  }
  private setRoomPosition(point: RoomPoint) {
    if (!this.session) this.camera.position.set(point.x, this.camera.position.y, point.z);
    else {
      const current = this.roomPosition();
      const delta = new THREE.Vector3(point.x - current.x, 0, point.z - current.z).applyQuaternion(
        this.office.root.getWorldQuaternion(new THREE.Quaternion()),
      );
      this.rig.position.add(delta);
      this.rig.updateMatrixWorld(true);
      this.renderer.xr.updateCamera(this.camera);
    }
  }
  private turn(radians: number) {
    if (!this.session) {
      this.yaw += radians;
      this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    } else {
      const pivot = this.renderer.xr.getCamera().getWorldPosition(new THREE.Vector3());
      const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), radians);
      this.rig.position.sub(pivot).applyQuaternion(rotation).add(pivot);
      this.rig.quaternion.premultiply(rotation);
      this.rig.updateMatrixWorld(true);
      this.renderer.xr.updateCamera(this.camera);
    }
  }
  /** Intentional point-and-click stations also work while free movement is paused. */
  navigate(action: string) {
    this.stopMovement();
    const station = officeLayout.stations[action];
    if (station) {
      this.turn(station.yaw - this.roomYaw());
      this.setRoomPosition(station);
      if (!this.session) {
        this.pitch = -0.03;
        this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
      }
    } else if (action === 'turn-left' || action === 'turn-right')
      this.turn(action === 'turn-left' ? Math.PI / 4 : -Math.PI / 4);
    else {
      const inputs: Record<string, RoomPoint> = {
        forward: { x: 0, z: -1 },
        back: { x: 0, z: 1 },
        left: { x: -1, z: 0 },
        right: { x: 1, z: 0 },
      };
      if (inputs[action]) {
        let point = this.roomPosition();
        for (let i = 0; i < 4; i++)
          point = moveInOffice(officeLayout, point, inputs[action]!, this.roomYaw(), 0.1);
        this.setRoomPosition(point);
      }
    }
    this.invalidate();
  }
  private moveDesktop(delta: number) {
    if (this.editing()) this.stopMovement();
    if (!this.walking || !this.pressed.size) return false;
    const input = {
      x: Number(this.pressed.has('KeyD')) - Number(this.pressed.has('KeyA')),
      z: Number(this.pressed.has('KeyS')) - Number(this.pressed.has('KeyW')),
    };
    const old = this.roomPosition(),
      next = moveInOffice(officeLayout, old, input, this.yaw, delta);
    this.setRoomPosition(next);
    return next.x !== old.x || next.z !== old.z;
  }
  private moveXR(delta: number) {
    if (!this.walking || this.recenterPending) return;
    const sources = this.controllers.filter(
      (controller) => controller.source?.gamepad?.mapping === 'xr-standard',
    );
    if (sources.some((controller) => !controller.ray.visible)) {
      this.xrNeedsNeutral = true;
      this.turnArmed = true;
      return;
    }
    const axes = (controller: (typeof sources)[number] | undefined) => {
      const values = controller?.source?.gamepad?.axes;
      return values && values.length >= 4 ? stickVector(values[2]!, values[3]!) : { x: 0, z: 0 };
    };
    if (this.xrNeedsNeutral) {
      if (
        sources.every((source) => {
          const value = axes(source);
          return !value.x && !value.z;
        })
      )
        this.xrNeedsNeutral = false;
      return;
    }
    const left = sources.find((source) => source.hand === 'left'),
      right = sources.find((source) => source.hand === 'right');
    const movement = axes(left ?? right);
    this.setRoomPosition(
      moveInOffice(officeLayout, this.roomPosition(), movement, this.roomYaw(), delta),
    );
    if (left && right) {
      const snap = snapTurn(axes(right).x, this.turnArmed);
      this.turnArmed = snap.armed;
      if (snap.radians) this.turn(snap.radians);
    }
  }
  private stopMovement = () => {
    this.pressed.clear();
    this.turnArmed = true;
    this.xrNeedsNeutral = true;
    this.dragging = null;
  };
  private onPageVisibility = () => {
    if (document.hidden) this.stopMovement();
  };
  private editing() {
    return !!(
      document.querySelector('dialog[open]') ||
      document.activeElement?.closest(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"])',
      )
    );
  }
  private onKeyDown = (event: KeyboardEvent) => {
    if (
      !this.walking ||
      this.session ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      this.editing()
    )
      return;
    if (['KeyQ', 'KeyE'].includes(event.code)) {
      if (!event.repeat) {
        this.turn(event.code === 'KeyQ' ? Math.PI / 4 : -Math.PI / 4);
        this.invalidate();
      }
      event.preventDefault();
      return;
    }
    if (!['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) return;
    event.preventDefault();
    if (!this.pressed.size) this.lastFrame = 0;
    this.pressed.add(event.code);
    this.invalidate();
  };
  private onKeyUp = (event: KeyboardEvent) => {
    this.pressed.delete(event.code);
  };
  dispose() {
    this.stopMovement();
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.stopMovement);
    document.removeEventListener('visibilitychange', this.onPageVisibility);
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
