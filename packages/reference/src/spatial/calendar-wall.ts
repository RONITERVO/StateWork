import * as THREE from 'three';
import { OfficeArt } from './office-art';
import type { CalendarView } from './calendar';
import type { OfficeTarget } from './office-world';

/** Canvas layout and controller hit targets share the same pixel rectangles. */
export class CalendarWall {
  readonly root = new THREE.Group();
  readonly targets: OfficeTarget[] = [];
  private art = new OfficeArt();
  private hits = new THREE.Group();
  private canvas = document.createElement('canvas');
  private texture: THREE.CanvasTexture;
  private previous?: CalendarView;
  private unit: THREE.PlaneGeometry;
  private hit: THREE.MeshBasicMaterial;
  constructor() {
    this.root.name = 'Rear-wall calendar';
    this.root.position.set(1, 1.78, 2.9);
    this.root.rotation.y = Math.PI;
    this.art.box(this.root, [4.5, 2.58, 0.075], [0, 0, 0], 'wood', 0.02);
    this.canvas.width = 2200;
    this.canvas.height = 1240;
    this.texture = this.art.ownTexture(new THREE.CanvasTexture(this.canvas));
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const paper = new THREE.Mesh(
      this.art.own(new THREE.PlaneGeometry(4.4, 2.48)),
      this.art.ownMaterial(new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false })),
    );
    paper.position.z = 0.05;
    this.root.add(paper, this.hits);
    this.unit = this.art.own(new THREE.PlaneGeometry(1, 1));
    this.hit = this.art.ownMaterial(
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false,
      }),
    );
    this.root.visible = false;
  }
  update(view?: CalendarView) {
    this.root.visible = !!view;
    if (!view || this.previous === view) return;
    this.previous = view;
    this.hits.clear();
    this.targets.length = 0;
    const c = this.canvas.getContext('2d')!;
    const rect = (x: number, y: number, w: number, h: number, color: string) => {
      c.fillStyle = color;
      c.fillRect(x, y, w, h);
    };
    const text = (
      label: string,
      x: number,
      y: number,
      size = 30,
      color = '#233d34',
      max = 1000,
    ) => {
      c.fillStyle = color;
      c.font = `600 ${size}px system-ui`;
      c.textBaseline = 'top';
      c.fillText(label, x, y, max);
    };
    const button = (
      label: string,
      action: string,
      x: number,
      y: number,
      w: number,
      h: number,
      fill = '#e6e3d1',
      fileId?: string,
    ) => {
      rect(x, y, w, h, fill);
      text(label, x + 12, y + (h - 28) / 2, 28, '#233d34', w - 24);
      const mesh = new THREE.Mesh(this.unit, this.hit);
      mesh.position.set((x + w / 2 - 1100) / 500, (620 - y - h / 2) / 500, 0.062);
      mesh.scale.set(w / 500, h / 500, 1);
      mesh.name = `Calendar: ${label}`;
      this.hits.add(mesh);
      this.targets.push({ mesh, action, ...(fileId ? { fileId } : {}) });
    };
    rect(0, 0, 2200, 1240, '#f3efdf');
    rect(0, 0, 2200, 140, '#234b3b');
    text(view.title.toUpperCase(), 36, 24, 53, '#fffdf4', 1340);
    text('YOUR DAYS · FLEXIBLE ORDER', 36, 92, 25, '#d7e3cb');
    button('←', 'cal:previous', 1480, 35, 85, 68);
    button('TODAY', 'cal:today', 1580, 35, 185, 68);
    button('→', 'cal:next', 1780, 35, 85, 68);
    button(
      view.mode === 'month' ? 'WEEK' : 'MONTH',
      `cal:mode:${view.mode === 'month' ? 'week' : 'month'}`,
      1880,
      35,
      275,
      68,
    );
    const gx = 32,
      gy = 282,
      gw = 1390,
      gap = 7,
      cw = (gw - 6 * gap) / 7,
      rows = view.mode === 'month' ? 6 : 1,
      ch = view.mode === 'month' ? 118 : 430;
    ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].forEach((label, i) =>
      text(label, gx + i * (cw + gap) + 16, 240, 25),
    );
    view.cells.forEach((cell, index) => {
      const x = gx + (index % 7) * (cw + gap),
        y = gy + Math.floor(index / 7) * (ch + gap);
      button(
        '',
        `cal:day:${cell.date}`,
        x,
        y,
        cw,
        ch,
        cell.selected ? '#b8d7b5' : cell.outside ? '#e1e1d5' : '#fffdf6',
      );
      if (cell.today) {
        c.strokeStyle = '#234b3b';
        c.lineWidth = 5;
        c.strokeRect(x + 3, y + 3, cw - 6, ch - 6);
      }
      text(String(Number(cell.date.slice(8))), x + 12, y + 10, 37);
      if (cell.today) text('TODAY', x + 69, y + 20, 20);
      if (cell.minutes) text(`○ ${cell.minutes}m`, x + 12, y + 58, 25);
      const facts = [
        cell.fixed ? `▣ ${cell.fixed}` : '',
        cell.due ? `◆ ${cell.due}` : '',
        cell.done ? `✓ ${cell.done}` : '',
      ]
        .filter(Boolean)
        .join('  ');
      if (facts) text(facts, x + 12, y + 96, 21, '#5e4729', cw - 20);
    });
    const ky = gy + rows * (ch + gap) + 16;
    text('○ SUGGESTED    ▣ APPOINTMENT    ◆ DUE    ✓ DONE', gx, ky, 24, '#486554', gw);
    rect(1460, 160, 708, 887, '#e5e7d8');
    text(view.selected === view.today ? 'TODAY → NEXT' : view.selected, 1485, 182, 35);
    text(view.capacity, 1485, 234, 29);
    text(view.summary, 1485, 279, 22, '#486554', 650);
    view.facts.slice(0, 2).forEach((fact, i) => text(fact, 1485, 315 + i * 27, 23, '#5e4729', 650));
    view.cards.forEach(({ item, suggestion: s }, i) => {
      const y = 380 + i * 180;
      rect(1485, y, 660, 169, s.conditional ? '#f0dec2' : '#fffdf6');
      text(`${s.order}. ${item.title}`, 1500, y + 14, 30, '#233d34', 630);
      text(
        `${s.estimated ? '≈ ' : ''}${s.minutes}m · ${s.conditional ? '◇ NEEDS FIRST' : '○ READY'}`,
        1500,
        y + 63,
        26,
      );
      button('HOLD FILE', `folder:${item.id}`, 1500, y + 109, 310, 56, '#c8dfc5', item.id);
      button('SCREEN ACTIONS', 'cal:open-view', 1825, y + 109, 305, 56);
    });
    if (!view.cards.length) {
      text('Room to breathe.', 1500, 380, 38);
      text('Open the screen for facts / review.', 1500, 443, 25, '#486554', 625);
    }
    button('←', 'cal:page:previous', 1485, 968, 92, 58);
    text(`${view.page + 1} / ${view.pages}`, 1600, 983, 28);
    button('→', 'cal:page:next', 1750, 968, 92, 58);
    button('OPEN SCREEN', 'cal:open-view', 1860, 968, 285, 58);
    text('TIME LEFT TODAY', 1050, 175, 24, '#486554', 365);
    [
      [30, '30m'],
      [60, '1h'],
      [120, '2h'],
      [240, '4h'],
      [0, 'DAY OFF'],
    ].forEach(([n, label], i) =>
      button(String(label), `cal:capacity:${n}`, 32 + i * 200, 156, 185, 60),
    );
    button('SCREEN VIEW', 'cal:open-view', 1070, 1132, 320, 70);
    button('DESK', 'move:desk', 1455, 1132, 200, 70);
    button('BOARD', 'move:board', 1670, 1132, 220, 70);
    button('CALENDAR', 'move:calendar', 1905, 1132, 255, 70);
    this.texture.needsUpdate = true;
  }
  dispose() {
    this.art.dispose();
    this.hits.clear();
    this.targets.length = 0;
  }
}
