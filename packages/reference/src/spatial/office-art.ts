import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type OfficeMaterial =
  | 'wood'
  | 'paper'
  | 'metal'
  | 'teal'
  | 'cream'
  | 'dark'
  | 'brass'
  | 'carpet'
  | 'orange';
const palette: Record<OfficeMaterial, number> = {
  wood: 0x94613d,
  paper: 0xf1ddb3,
  metal: 0x718780,
  teal: 0x295653,
  cream: 0xd6c7a8,
  dark: 0x283836,
  brass: 0xcfa35b,
  carpet: 0x68645a,
  orange: 0xad582f,
};

/** Reusable original meshes and deterministic surface textures. Nothing is fetched. */
export class OfficeArt {
  textScale = 1;
  private geometries = new Set<THREE.BufferGeometry>();
  private materials = new Set<THREE.Material>();
  private textures = new Set<THREE.Texture>();
  private materialCache = new Map<string, THREE.MeshStandardMaterial>();
  material(name: OfficeMaterial, color?: THREE.ColorRepresentation) {
    const key = `${name}:${color ?? ''}`;
    let material = this.materialCache.get(key);
    if (!material) {
      material = new THREE.MeshStandardMaterial({
        color: color ?? palette[name],
        roughness: name === 'brass' ? 0.28 : name === 'metal' ? 0.5 : 0.88,
        metalness: ['brass', 'metal'].includes(name) ? 0.58 : 0,
      });
      if (name === 'wood' || name === 'carpet' || name === 'paper')
        material.map = this.surface(name);
      this.materialCache.set(key, material);
      this.materials.add(material);
    }
    return material;
  }
  private surface(name: string) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 900; i++) {
      const x = (i * 73.113) % 128,
        y = (i * 37.917) % 128;
      ctx.fillStyle = `rgba(32,22,14,${name === 'wood' ? 0.08 : name === 'carpet' ? 0.2 : 0.04})`;
      ctx.fillRect(x, y, name === 'wood' ? 30 + (i % 80) : 1.5, name === 'wood' ? 0.5 : 1.5);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(name === 'carpet' ? 12 : 2, name === 'carpet' ? 12 : 2);
    this.textures.add(texture);
    return texture;
  }
  own<T extends THREE.BufferGeometry>(geometry: T): T {
    this.geometries.add(geometry);
    return geometry;
  }
  ownMaterial<T extends THREE.Material>(material: T): T {
    this.materials.add(material);
    return material;
  }
  discardGeometry(geometry: THREE.BufferGeometry) {
    geometry.dispose();
    this.geometries.delete(geometry);
  }
  box(
    parent: THREE.Object3D,
    size: [number, number, number],
    position: [number, number, number],
    material: OfficeMaterial | THREE.Material = 'cream',
    radius = 0.012,
  ) {
    const geometry = this.own(
      radius
        ? new RoundedBoxGeometry(...size, 1, Math.min(radius, ...size.map((v) => v / 3)))
        : new THREE.BoxGeometry(...size),
    );
    const mesh = new THREE.Mesh(
      geometry,
      typeof material === 'string' ? this.material(material) : material,
    );
    mesh.position.set(...position);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  cylinder(
    parent: THREE.Object3D,
    top: number,
    bottom: number,
    height: number,
    position: [number, number, number],
    material: OfficeMaterial = 'cream',
    segments = 20,
  ) {
    const mesh = new THREE.Mesh(
      this.own(new THREE.CylinderGeometry(top, bottom, height, segments)),
      this.material(material),
    );
    mesh.position.set(...position);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  torus(
    parent: THREE.Object3D,
    radius: number,
    tube: number,
    position: [number, number, number],
    material: OfficeMaterial = 'brass',
  ) {
    const mesh = new THREE.Mesh(
      this.own(new THREE.TorusGeometry(radius, tube, 8, 24)),
      this.material(material),
    );
    mesh.position.set(...position);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }
  label(
    parent: THREE.Object3D,
    title: string,
    subtitle: string,
    width: number,
    height: number,
    position: [number, number, number],
    options: {
      background?: string;
      color?: string;
      accent?: string;
      font?: string;
      size?: number;
      align?: CanvasTextAlign;
      scanlines?: boolean;
    } = {},
  ) {
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = Math.round((768 * height) / width);
    const ctx = canvas.getContext('2d')!;
    const w = canvas.width,
      h = canvas.height;
    ctx.fillStyle = options.background ?? '#eddeb8';
    ctx.fillRect(0, 0, w, h);
    const font = options.font ?? 'Courier New';
    ctx.fillStyle = options.accent ?? '#a0643b';
    ctx.fillRect(20, 18, 8, h - 36);
    ctx.textAlign = options.align ?? 'left';
    ctx.textBaseline = 'top';
    const x = options.align === 'center' ? w / 2 : 48;
    let titleSize = Math.min((options.size ?? (h < 150 ? 54 : 52)) * this.textScale, h * 0.65);
    ctx.font = `bold ${titleSize}px ${font}, monospace`;
    let titleLines = wrapText(ctx, title, w - 90, 2);
    const titleRoom = subtitle ? h * 0.5 : h - 24;
    while (titleLines.length * titleSize * 1.12 > titleRoom && titleSize > 20) {
      titleSize *= 0.9;
      ctx.font = `bold ${titleSize}px ${font}, monospace`;
      titleLines = wrapText(ctx, title, w - 90, 2);
    }
    ctx.fillStyle = options.color ?? '#263d36';
    let y = h < 150 ? Math.max(12, (h - titleLines.length * titleSize * 1.12) / 2) : 30;
    for (const line of titleLines) {
      ctx.fillText(line, x, y);
      y += titleSize * 1.12;
    }
    if (subtitle && y < h - 30) {
      y += 18;
      ctx.font = `600 ${Math.round(titleSize * 0.7)}px ${font}, monospace`;
      for (const line of wrapText(
        ctx,
        subtitle,
        w - 90,
        Math.max(1, Math.floor((h - y - 20) / (titleSize * 0.82))),
      )) {
        ctx.fillText(line, x, y);
        y += titleSize * 0.82;
      }
    }
    if (options.scanlines) {
      ctx.fillStyle = '#001e1822';
      for (let y = 0; y < h; y += 5) ctx.fillRect(0, y, w, 2);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    this.textures.add(texture);
    const material = this.ownMaterial(
      new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
    );
    const mesh = new THREE.Mesh(this.own(new THREE.PlaneGeometry(width, height)), material);
    mesh.position.set(...position);
    parent.add(mesh);
    return mesh;
  }
  dispose() {
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.textures.forEach((t) => t.dispose());
    this.geometries.clear();
    this.materials.clear();
    this.textures.clear();
  }
}
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  width: number,
  maxLines: number,
) {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(' ')) {
      if (ctx.measureText(`${line} ${word}`).width > width && line) {
        lines.push(line);
        line = '';
      }
      for (const char of (line ? ' ' : '') + word) {
        if (ctx.measureText(line + char).width > width && line) {
          lines.push(line);
          line = '';
        }
        line += char;
      }
    }
    if (line) lines.push(line);
  }
  if (lines.length > maxLines) lines[maxLines - 1] = `${lines[maxLines - 1]!.slice(0, -2)}…`;
  return lines.slice(0, maxLines);
}

export function makeOfficeShell(art: OfficeArt) {
  const room = new THREE.Group();
  room.name = '1986-office';
  art.box(room, [7.8, 0.12, 7], [0, -0.08, -0.45], 'carpet', 0);
  art.box(room, [7.8, 3.2, 0.15], [0, 1.55, -3.1], 'cream', 0);
  art.box(room, [0.15, 3.2, 7], [-3.9, 1.55, -0.45], 'cream', 0);
  art.box(room, [0.15, 3.2, 7], [3.9, 1.55, -0.45], 'cream', 0);
  art.box(room, [7.8, 0.06, 7], [0, 3.15, -0.45], 'cream', 0);
  // Wainscot and acoustic ceiling grid establish human scale.
  art.box(room, [7.6, 0.65, 0.04], [0, 0.33, -3.0], 'wood', 0);
  art.box(room, [7.7, 0.055, 0.055], [0, 0.7, -2.97], 'brass', 0);
  for (let i = 0; i < 9; i++)
    art.box(room, [0.018, 0.016, 6.8], [-3.7 + i * 0.92, 3.11, -0.5], 'metal', 0);
  for (let i = 0; i < 8; i++)
    art.box(room, [7.7, 0.016, 0.018], [0, 3.11, -3 + i * 0.9], 'metal', 0);
  const emissive = art.ownMaterial(
    new THREE.MeshStandardMaterial({
      color: '#f9edc8',
      emissive: '#fff0cc',
      emissiveIntensity: 0.65,
      roughness: 0.4,
    }),
  );
  for (const x of [-1.8, 1.8]) {
    art.box(room, [1.4, 0.04, 0.5], [x, 3.08, -0.2], 'metal');
    art.box(room, [1.24, 0.018, 0.36], [x, 3.05, -0.2], emissive);
  }
  // A sunlit window with individual venetian slats.
  const windowGroup = new THREE.Group();
  windowGroup.position.set(-3.79, 1.9, -0.65);
  windowGroup.rotation.y = Math.PI / 2;
  room.add(windowGroup);
  art.box(windowGroup, [2.7, 1.62, 0.05], [0, 0, 0], 'dark');
  const sky = art.ownMaterial(new THREE.MeshBasicMaterial({ color: '#aabdc0' }));
  art.box(windowGroup, [2.55, 1.49, 0.025], [0, 0, 0.04], sky);
  for (let i = 0; i < 13; i++) {
    const slat = art.box(
      windowGroup,
      [2.65, 0.06, 0.14],
      [0, -0.71 + i * 0.118, 0.12],
      'cream',
      0.004,
    );
    slat.rotation.x = 0.23;
  }
  art.box(windowGroup, [2.8, 0.08, 0.26], [0, -0.84, 0.1], 'wood');
  // An original calendar and notice board, rather than borrowed game branding.
  art.box(room, [1.12, 0.74, 0.06], [1.93, 2.26, -2.98], 'wood');
  art.label(
    room,
    'STATEWORK',
    'RECORDS & RESEARCH\nDEPARTMENT  /  1986',
    1.02,
    0.64,
    [1.93, 2.26, -2.939],
    { background: '#708076', color: '#fff0cb', font: 'Georgia', size: 62 },
  );
  art.label(
    room,
    'SEPTEMBER',
    '01 02 03 04 05 06 07\n08 09 10 11 12 13 14\n15 16 17 18 19 20 21\n22 23 24 25 26 27 28',
    0.45,
    0.52,
    [-2.8, 2.12, -2.99],
    { size: 55 },
  );
  const clock = art.cylinder(room, 0.18, 0.18, 0.05, [0, 2.66, -2.97], 'cream', 32);
  clock.rotation.x = Math.PI / 2;
  art.label(room, '12', '9     ·     3\n6', 0.27, 0.3, [0, 2.66, -2.93], {
    background: '#f3e7c6',
    size: 54,
    align: 'center',
  });
  // Large desk, leather blotter, drawers, brass trim.
  art.box(room, [3.15, 0.095, 1.28], [0, 0.79, 0.3], 'wood', 0.025);
  art.box(room, [3.16, 0.025, 1.29], [0, 0.757, 0.3], 'dark', 0.01);
  for (const x of [-1.19, 1.19]) {
    art.box(room, [0.54, 0.68, 0.93], [x, 0.39, 0.19], 'wood', 0.02);
    for (let i = 0; i < 3; i++) {
      art.box(room, [0.49, 0.19, 0.035], [x, 0.21 + i * 0.2, 0.68], 'wood');
      art.box(room, [0.2, 0.027, 0.032], [x, 0.21 + i * 0.2, 0.712], 'brass');
    }
  }
  art.box(room, [1.3, 0.009, 0.62], [0.2, 0.842, 0.34], 'teal', 0.025);
  // Beige CRT workstation.
  const crt = new THREE.Group();
  crt.position.set(-0.83, 0.86, -0.06);
  crt.rotation.y = 0.17;
  room.add(crt);
  art.box(crt, [0.52, 0.07, 0.4], [0, 0.035, 0], 'cream');
  art.box(crt, [0.16, 0.15, 0.15], [0, 0.13, -0.03], 'dark');
  art.box(crt, [0.64, 0.47, 0.42], [0, 0.42, -0.055], 'cream', 0.04);
  art.box(crt, [0.55, 0.36, 0.025], [0, 0.44, 0.166], 'dark', 0.02);
  art.label(crt, 'STATEWORK', 'READY.\nSELECT A FOLDER\nTO BEGIN_', 0.49, 0.29, [0, 0.44, 0.182], {
    background: '#142d26',
    color: '#a5e3a5',
    accent: '#689d68',
    scanlines: true,
    size: 60,
  });
  art.cylinder(crt, 0.018, 0.018, 0.02, [0.255, 0.24, 0.173], 'orange', 12).rotation.x =
    Math.PI / 2;
  const keyboard = art.box(room, [0.66, 0.055, 0.23], [-0.82, 0.88, 0.42], 'cream');
  keyboard.rotation.x = 0.06;
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 12; col++)
      art.box(
        room,
        [0.041, 0.012, 0.032],
        [-1.105 + col * 0.051, 0.916, 0.345 + row * 0.049],
        'cream',
        0.005,
      );
  art.box(room, [0.28, 0.012, 0.034], [-0.81, 0.916, 0.54], 'dark', 0.004);
  // Desk telephone and coiled cord.
  const phone = new THREE.Group();
  phone.name = 'office:phone';
  phone.position.set(1.04, 0.87, 0.14);
  phone.rotation.y = -0.25;
  room.add(phone);
  art.box(phone, [0.36, 0.08, 0.28], [0, 0.035, 0], 'orange', 0.03);
  art.label(phone, 'NEXT STEP', '', 0.24, 0.05, [0, 0.04, 0.145], { size: 72 });
  art.box(phone, [0.36, 0.06, 0.09], [0, 0.125, -0.07], 'dark', 0.025);
  for (const x of [-0.15, 0.15])
    art.box(phone, [0.1, 0.07, 0.13], [x, 0.115, -0.07], 'dark', 0.025);
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++)
      art.box(
        phone,
        [0.035, 0.016, 0.033],
        [-0.05 + col * 0.05, 0.087, 0.015 + row * 0.044],
        'cream',
        0.004,
      );
  for (let i = 0; i < 20; i++) {
    const ring = art.torus(
      phone,
      0.021,
      0.005,
      [-0.21, 0.05 - i * 0.007, -0.08 + i * 0.013],
      'dark',
    );
    ring.rotation.y = Math.PI / 2;
  }
  // Desk lamp, pencils, mug, stapler, tape and paper tray.
  art.cylinder(room, 0.13, 0.14, 0.025, [1.25, 0.86, -0.18], 'teal');
  art.box(room, [0.03, 0.47, 0.03], [1.25, 1.1, -0.18], 'brass');
  const shade = art.cylinder(room, 0.1, 0.2, 0.12, [1.2, 1.37, -0.14], 'teal');
  shade.name = 'office:lamp';
  shade.rotation.z = 0.22;
  art.cylinder(room, 0.055, 0.05, 0.13, [0.79, 0.908, 0.55], 'cream');
  const mugHandle = art.torus(room, 0.047, 0.012, [0.853, 0.934, 0.55], 'cream');
  mugHandle.rotation.y = Math.PI / 2;
  art.cylinder(room, 0.045, 0.045, 0.003, [0.79, 0.975, 0.55], 'dark');
  art.cylinder(room, 0.055, 0.045, 0.12, [-1.34, 0.905, 0.22], 'dark');
  for (let i = 0; i < 5; i++) {
    const pen = art.box(
      room,
      [0.007, 0.19, 0.007],
      [-1.36 + i * 0.012, 1.04, 0.22],
      'orange',
      0.001,
    );
    pen.rotation.z = (i - 2) * 0.065;
  }
  art.box(room, [0.06, 0.025, 0.17], [0.77, 0.875, 0.69], 'dark');
  art.box(room, [0.065, 0.035, 0.16], [0.77, 0.904, 0.68], 'orange');
  art.box(room, [0.43, 0.07, 0.28], [-0.12, 0.88, -0.08], 'metal');
  art.box(room, [0.39, 0.033, 0.24], [-0.12, 0.93, -0.08], 'paper', 0.002);
  art.label(room, 'IN / OUT', '', 0.25, 0.05, [-0.12, 0.887, 0.065], { size: 62 });
  // A potted plant and a compact bookcase fill the edges of the room.
  art.cylinder(room, 0.19, 0.13, 0.37, [3.08, 0.19, -2.3], 'orange');
  art.cylinder(room, 0.17, 0.17, 0.015, [3.08, 0.381, -2.3], 'dark');
  for (let i = 0; i < 11; i++) {
    const angle = i * 2.4;
    const leaf = new THREE.Mesh(
      art.own(new THREE.SphereGeometry(0.16, 10, 6)),
      art.material('teal', i % 2 ? '#45634a' : '#698154'),
    );
    leaf.scale.set(0.42, 2.2, 0.2);
    leaf.position.set(
      3.08 + Math.sin(angle) * 0.22,
      0.7 + (i % 3) * 0.16,
      -2.3 + Math.cos(angle) * 0.18,
    );
    leaf.rotation.z = Math.sin(angle) * 0.6;
    room.add(leaf);
    const stem = art.box(
      room,
      [0.007, 0.65, 0.007],
      [3.08 + Math.sin(angle) * 0.08, 0.63, -2.3 + Math.cos(angle) * 0.08],
      'teal',
      0,
    );
    stem.rotation.z = Math.sin(angle) * 0.25;
  }
  art.box(room, [0.78, 1.3, 0.35], [-3.0, 0.66, -1.9], 'wood');
  for (let row = 0; row < 3; row++) {
    art.box(room, [0.72, 0.027, 0.37], [-3, 0.28 + row * 0.37, -1.87], 'cream');
    for (let i = 0; i < 8; i++)
      art.box(
        room,
        [0.055, 0.25 + (i % 3) * 0.02, 0.22],
        [-3.3 + i * 0.082, 0.43 + row * 0.37, -1.78],
        i % 3 === 0 ? 'teal' : i % 3 === 1 ? 'orange' : 'cream',
        0.003,
      );
  }
  mergeFurniture(room, art);
  return room;
}

/** Static furniture shares draw calls; movable/selectable props keep their identity. */
function mergeFurniture(room: THREE.Group, art: OfficeArt) {
  room.updateMatrixWorld(true);
  const groups = new Map<string, THREE.Mesh[]>();
  room.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || Array.isArray(object.material)) return;
    for (let ancestor: THREE.Object3D | null = object; ancestor; ancestor = ancestor.parent)
      if (ancestor.name === 'office:phone' || ancestor.name === 'office:lamp') return;
    const key = `${object.material.uuid}/${object.castShadow}/${object.receiveShadow}`;
    groups.set(key, [...(groups.get(key) ?? []), object]);
  });
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    const pieces = meshes.map((mesh) => {
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      return geometry.applyMatrix4(mesh.matrixWorld);
    });
    const geometry = mergeGeometries(pieces, false);
    pieces.forEach((piece) => piece.dispose());
    if (!geometry) throw new Error('Unable to combine office furniture geometry.');
    const batch = new THREE.Mesh(art.own(geometry), meshes[0]!.material);
    batch.castShadow = meshes[0]!.castShadow;
    batch.receiveShadow = meshes[0]!.receiveShadow;
    batch.name = 'Static furniture batch';
    room.add(batch);
    meshes.forEach((mesh) => {
      mesh.removeFromParent();
      art.discardGeometry(mesh.geometry);
    });
  }
}

export function makeFolder(art: OfficeArt, title: string, subtitle: string, color = '#bd9252') {
  const group = new THREE.Group();
  group.name = 'folder';
  const cover = art.material('paper', color);
  art.box(group, [0.4, 0.31, 0.022], [0, 0, 0], cover, 0.008);
  art.box(group, [0.115, 0.055, 0.023], [-0.12, 0.175, 0], cover, 0.007);
  art.box(group, [0.37, 0.284, 0.015], [0, 0.012, 0.014], 'paper', 0.002);
  art.box(group, [0.4, 0.303, 0.009], [0, -0.008, 0.027], cover, 0.004);
  art.label(group, title, subtitle, 0.345, 0.239, [0, 0.003, 0.0325], {
    background: '#f5e8c6',
    color: '#263b33',
    accent: color,
    size: 59,
  });
  art.label(group, title, '', 0.11, 0.03, [-0.12, 0.183, 0.014], {
    size: 90,
    background: '#f5e8c6',
  });
  return group;
}
export function makeKey(art: OfficeArt, label: string, waived = false) {
  const group = new THREE.Group();
  art.torus(group, 0.045, 0.01, [0, 0.06, 0], waived ? 'metal' : 'brass');
  art.box(group, [0.019, 0.13, 0.016], [0, -0.025, 0], waived ? 'metal' : 'brass', 0.003);
  art.box(group, [0.045, 0.015, 0.015], [0.012, -0.077, 0], waived ? 'metal' : 'brass', 0.002);
  art.box(group, [0.036, 0.014, 0.015], [0.009, -0.047, 0], waived ? 'metal' : 'brass', 0.002);
  art.label(group, label, waived ? 'WAIVED' : 'EARNED', 0.17, 0.1, [0.12, 0.056, 0.006], {
    size: 66,
    background: waived ? '#c1d3cc' : '#efe1b2',
  });
  return group;
}
