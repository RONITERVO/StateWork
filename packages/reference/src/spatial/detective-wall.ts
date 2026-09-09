import * as THREE from 'three';
import { OfficeArt } from './office-art';
import { paintCaseBoard } from './detective-drawing';
import type { DetectiveView } from './detective-board';
import type { CaseBoard } from './detective-model';
import type { OfficeTarget } from './office-world';

/** A real right-wall board. The texture and hit regions use the same layout transform. */
export class DetectiveWall {
  readonly root = new THREE.Group();
  readonly targets: OfficeTarget[] = [];
  private staticArt = new OfficeArt();
  private art = new OfficeArt();
  private content = new THREE.Group();
  private canvas = document.createElement('canvas');
  private texture: THREE.CanvasTexture;
  private lastBoard?: CaseBoard;
  private lastLarge = false;
  private lastWalking = true;
  constructor() {
    this.root.name = 'Right-wall detective board';
    this.root.position.set(3.78, 1.68, -0.25);
    this.root.rotation.y = -Math.PI / 2;
    this.staticArt.box(this.root, [4.92, 2.74, 0.085], [0, 0, 0], 'wood', 0.022);
    this.staticArt.box(
      this.root,
      [4.74, 2.56, 0.025],
      [0, 0, 0.05],
      this.staticArt.material('paper', '#987750'),
      0,
    );
    this.staticArt.box(this.root, [0.5, 1.35, 0.08], [2.75, -0.1, 0], 'wood');
    for (const x of [-2.33, 2.33])
      for (const y of [-1.24, 1.24]) {
        const screw = this.staticArt.cylinder(
          this.root,
          0.016,
          0.016,
          0.012,
          [x, y, 0.067],
          'brass',
          10,
        );
        screw.rotation.x = Math.PI / 2;
      }
    this.canvas.width = 2200;
    this.canvas.height = 880;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const paper = new THREE.Mesh(
      this.staticArt.own(new THREE.PlaneGeometry(4.4, 1.76)),
      this.staticArt.ownMaterial(new THREE.MeshBasicMaterial({ map: this.texture })),
    );
    paper.position.set(0, 0.08, 0.075);
    this.root.add(paper, this.content);
    this.root.visible = false;
  }
  update(view?: DetectiveView, large = false, walking = true) {
    this.root.visible = !!view;
    if (
      !view ||
      (view.board === this.lastBoard && large === this.lastLarge && walking === this.lastWalking)
    )
      return;
    this.lastBoard = view.board;
    this.lastLarge = large;
    this.lastWalking = walking;
    this.content.clear();
    this.art.dispose();
    this.art = new OfficeArt();
    this.art.textScale = large ? 1.15 : 1;
    this.targets.length = 0;
    const ctx = this.canvas.getContext('2d')!;
    const transform = paintCaseBoard(ctx, view.board, this.canvas.width, this.canvas.height);
    this.texture.needsUpdate = true;
    const hit = this.art.ownMaterial(
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthWrite: false,
        colorWrite: false,
      }),
    );
    const unit = this.art.own(new THREE.PlaneGeometry(1, 1));
    const pinGeometry = this.art.own(new THREE.SphereGeometry(0.011, 8, 6));
    const pinMaterial = this.art.ownMaterial(
      new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.55 }),
    );
    const pins = new THREE.InstancedMesh(pinGeometry, pinMaterial, view.board.cards.length);
    const matrix = new THREE.Matrix4();
    view.board.cards.forEach((card, index) => {
      const x =
        ((transform.offsetX + (card.x + card.width / 2) * transform.scale) / this.canvas.width -
          0.5) *
        4.4;
      const y =
        (0.5 -
          (transform.offsetY + (card.y + card.height / 2) * transform.scale) / this.canvas.height) *
          1.76 +
        0.08;
      const width = ((card.width * transform.scale) / this.canvas.width) * 4.4;
      const height = ((card.height * transform.scale) / this.canvas.height) * 1.76;
      const target = new THREE.Mesh(unit, hit);
      target.position.set(x, y, 0.098);
      target.scale.set(width, height, 1);
      target.name = `Board card: ${card.label}`;
      this.content.add(target);
      this.targets.push({
        mesh: target,
        action: `board:open:${encodeURIComponent(card.id)}`,
        fileId: card.recordId ?? undefined,
      });
      matrix.makeTranslation(x, y + height / 2 - 0.008, 0.092);
      pins.setMatrixAt(index, matrix);
      pins.setColorAt(index, new THREE.Color(card.selected ? '#246d52' : '#a33f2b'));
    });
    this.content.add(pins);
    const label = (
      title: string,
      subtitle: string,
      width: number,
      height: number,
      position: [number, number, number],
      size = 70,
    ) => {
      // Two explicit lines keep coverage and requirements visible on a wide strip.
      const strip = document.createElement('canvas');
      strip.width = 2048;
      strip.height = Math.round((strip.width * height) / width);
      const text = strip.getContext('2d')!;
      text.fillStyle = '#203f31';
      text.fillRect(0, 0, strip.width, strip.height);
      text.fillStyle = '#eff1d9';
      text.textBaseline = 'top';
      text.font = `bold ${Math.min(size, strip.height * 0.44)}px monospace`;
      text.fillText(title, 22, strip.height * 0.07, strip.width - 44);
      text.font = `${strip.height * 0.27}px monospace`;
      text.fillText(subtitle, 22, strip.height * 0.63, strip.width - 44);
      const texture = this.art.ownTexture(new THREE.CanvasTexture(strip));
      texture.colorSpace = THREE.SRGBColorSpace;
      const face = new THREE.Mesh(
        this.art.own(new THREE.PlaneGeometry(width, height)),
        this.art.ownMaterial(new THREE.MeshBasicMaterial({ map: texture })),
      );
      face.position.set(...position);
      this.content.add(face);
    };
    label(
      view.board.title.toUpperCase(),
      `${view.board.counts.total} OF ${view.board.workspaceCounts.total} RECORDS  ·  ${view.board.shownLinks} THREADS  ·  REV ${view.board.revision}`,
      4.36,
      0.2,
      [0, 1.16, 0.08],
      86,
    );
    const selected = view.board.focus;
    label(
      selected ? selected.item.title : 'PICK A CARD · FOLLOW A THREAD · KEEP A PIN',
      selected
        ? `${view.board.requirements} BEFORE  /  ${view.board.impact} AFTER${selected.item.archived ? '  /  ARCHIVED' : ''}`
        : `${view.board.counts.waiting} NEED FIRST  /  ${view.board.counts.ready} READY  /  ${view.board.counts.done} DONE`,
      4.36,
      0.18,
      [0, -0.88, 0.08],
      82,
    );
    const controls = [
      ['WHOLE CASE', 'board:overview', true],
      ['BACK', 'board:back', true],
      ['NEEDS FIRST', 'board:lens:requirements', !!selected],
      ['WHAT FOLLOWS', 'board:lens:impact', !!selected],
      ['UNBLOCK', 'board:lens:unblock', true],
      ['CONTEXT', 'board:context', true],
      [
        selected && view.session.pins.includes(selected.item.id) ? 'UNPIN FILE' : 'PIN FILE',
        'board:pin',
        !!selected,
      ],
      ['HOLD FILE', selected ? `folder:${selected.item.id}` : '', !!selected],
      ['SCREEN VIEW', 'board:open-view', true],
    ] as const;
    controls.forEach(([title, action, enabled], index) => {
      const x = -1.96 + index * 0.49;
      const face = this.art.label(this.content, title, '', 0.46, 0.12, [x, -1.12, 0.095], {
        size: 78,
        background: enabled ? '#ead9b4' : '#a1947a',
        color: '#273b30',
        align: 'center',
      });
      if (enabled) this.targets.push({ mesh: face, action });
    });
    [
      ['DESK', 'move:desk'],
      ['BOARD', 'move:board'],
      ['TURN LEFT', 'move:turn-left'],
      ['TURN RIGHT', 'move:turn-right'],
      [walking ? 'MOVE ON' : 'MOVE OFF', 'move:toggle'],
    ].forEach(([title, action], index) => {
      const face = this.art.label(
        this.content,
        title!,
        '',
        0.44,
        0.18,
        [2.75, 0.4 - index * 0.25, 0.085],
        { size: 80, background: '#ead9b4', color: '#273b30', align: 'center' },
      );
      this.targets.push({ mesh: face, action: action! });
    });
    // Memory pins stay physically beside the map; every saved pin has a visible target.
    view.pins.forEach((pin, index) => {
      const x = -2.08 + index * 0.378;
      const face = this.art.label(
        this.content,
        `${index + 1}`,
        pin.label,
        0.35,
        0.095,
        [x, -1.28, 0.096],
        { size: 64, background: '#cbdabe', color: '#253f2d', align: 'center' },
      );
      this.targets.push({
        mesh: face,
        action: `board:focus:${encodeURIComponent(pin.id)}`,
        fileId: pin.id,
      });
    });
  }
  dispose() {
    this.art.dispose();
    this.staticArt.dispose();
    this.texture.dispose();
    this.root.removeFromParent();
    this.targets.length = 0;
  }
}
