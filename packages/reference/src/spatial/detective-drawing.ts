import { caseMarks } from './detective-model';
import type { CaseBoard, CaseCard, CaseMark, CaseThread } from './detective-model';

export const caseEscape = (value: unknown) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function caseLines(value: string, columns = 19, max = 2): string[] {
  const words = value.replace(/\s+/g, ' ').trim().split(' '),
    lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && line.length + word.length + 1 > columns) {
      lines.push(line);
      line = '';
    }
    if (word.length > columns) {
      if (line) {
        lines.push(line);
        line = '';
      }
      for (let i = 0; i < word.length; i += columns) lines.push(word.slice(i, i + columns));
    } else line += (line ? ' ' : '') + word;
  }
  if (line) lines.push(line);
  if (lines.length > max)
    return [...lines.slice(0, max - 1), `${lines[max - 1]!.slice(0, columns - 1)}…`];
  return lines;
}
export function caseCurve(from: CaseCard, to: CaseCard) {
  // Route through the shelf gutters. A thread must never disappear behind an
  // unrelated card and imply that the unrelated card is part of the dependency.
  const sameColumn = from.x === to.x,
    right = to.x > from.x;
  const x1 = right ? from.x + from.width + 3 : from.x - 3;
  const x2 = sameColumn || right ? to.x - 3 : to.x + to.width + 3;
  // Separate outgoing and incoming ports so two threads sharing a card's
  // edge cannot look like a bidirectional connection to its neighbour.
  const y1 = from.y + from.height * 0.38,
    y2 = to.y + to.height * (sameColumn || right ? 0.6 : 0.82);
  const lane1 = right ? from.x + from.width + 14 : from.x - 14;
  const lane2 = sameColumn || right ? to.x - 32 : to.x + to.width + 32;
  const adjacent = from.y === to.y && Math.abs(to.x - from.x) === 266;
  const corridor = adjacent
    ? (y1 + y2) / 2
    : to.y > from.y
      ? from.y + from.height + 28
      : from.y - 28;
  const points = [
    { x: x1, y: y1 },
    { x: lane1, y: y1 },
    { x: lane1, y: corridor },
    { x: lane2, y: corridor },
    { x: lane2, y: y2 },
    { x: x2, y: y2 },
  ];
  let longest = -1,
    labelX = x1,
    labelY = y1;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!,
      distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (distance > longest) {
      longest = distance;
      labelX = (a.x + b.x) / 2;
      labelY = (a.y + b.y) / 2;
    }
  }
  const before = points.at(-2)!;
  return {
    points,
    path: points.map((point, i) => `${i ? 'L' : 'M'}${point.x} ${point.y}`).join(' '),
    x1,
    y1,
    x2,
    y2,
    c2x: before.x,
    c2y: before.y,
    labelX,
    labelY,
  };
}
function threadStyle(thread: CaseThread, selected: boolean) {
  return {
    color:
      thread.kind === 'depends_on'
        ? thread.missing
          ? '#a8432a'
          : '#286754'
        : thread.kind === 'contains'
          ? '#ece0bb'
          : '#3b526f',
    opacity: selected && !thread.selected ? 0.17 : thread.kind === 'depends_on' ? 0.88 : 0.55,
    width: thread.selected ? 4 : Math.min(3.5, 1.3 + Math.log2(thread.count + 1) * 0.5),
    dash: thread.kind === 'contains' ? [7, 6] : thread.kind === 'relates_to' ? [2, 6] : [],
  };
}
const countLine = (card: CaseCard) =>
  card.lead
    ? `${card.lead.opens} open now · ${card.lead.reaches} reach${card.lead.archived ? ' · Archived' : ''}`
    : card.recordId
      ? `${caseMarks[(Object.keys(caseMarks) as CaseMark[]).find((mark) => card.counts[mark])!].symbol} ${caseMarks[(Object.keys(caseMarks) as CaseMark[]).find((mark) => card.counts[mark])!].label}${card.counts.archived ? ' · Archived' : ''}`
      : `${card.counts.total} records · ${card.counts.waiting} need first`;
export const caseCardLabel = (card: CaseCard) =>
  `${card.label}. ${countLine(card)}.${card.recordId ? ' Inspect file.' : ' Open group.'}${card.pinned ? ' Pinned.' : ''}`;

/** SVG and wall texture share the same coordinates, membership and directed threads. */
export function caseSvg(board: CaseBoard): string {
  const byId = new Map(board.cards.map((card) => [card.id, card]));
  const selected = board.cards.some((card) => card.selected);
  const threads = board.threads
    .map((thread) => {
      const a = byId.get(thread.from)!,
        b = byId.get(thread.to)!,
        p = caseCurve(a, b),
        style = threadStyle(thread, selected);
      const angle = Math.atan2(p.y2 - p.c2y, p.x2 - p.c2x),
        dx = Math.cos(angle),
        dy = Math.sin(angle);
      const triangle = `${p.x2},${p.y2} ${p.x2 - 10 * dx + 5 * dy},${p.y2 - 10 * dy - 5 * dx} ${p.x2 - 10 * dx - 5 * dy},${p.y2 - 10 * dy + 5 * dx}`;
      return `<g opacity="${style.opacity}"><title>${caseEscape(`${a.label} → ${b.label} · ${thread.count} ${thread.kind === 'depends_on' ? 'requirements' : thread.kind === 'contains' ? 'parent links' : 'related links'}`)}</title><path d="${p.path}" fill="none" stroke="${style.color}" stroke-width="${style.width}" stroke-linejoin="round" stroke-dasharray="${style.dash.join(' ')}"/>${thread.kind === 'relates_to' ? '' : `<polygon points="${triangle}" fill="${style.color}"/>`}${thread.count > 1 ? `<g transform="translate(${p.labelX},${p.labelY})"><rect x="-14" y="-10" width="28" height="20" rx="7" fill="#f2e5c8"/><text text-anchor="middle" y="4" font-size="12" fill="#302b23">${thread.count}</text></g>` : ''}</g>`;
    })
    .join('');
  const cards = board.cards
    .map((card) => {
      let at = 0;
      const stripe = (Object.keys(caseMarks) as CaseMark[])
        .map((mark) => {
          const width = ((card.width - 24) * card.counts[mark]) / card.counts.total;
          const rect = `<rect x="${12 + at}" y="${card.height - 22}" width="${width}" height="8" fill="${caseMarks[mark].ink}"/>`;
          at += width;
          return rect;
        })
        .join('');
      return `<g class="case-card${card.selected ? ' selected' : ''}" transform="translate(${card.x},${card.y})" role="button" tabindex="0" aria-label="${caseEscape(caseCardLabel(card))}" data-case-card="${caseEscape(card.id)}"><rect class="case-card-shadow" x="3" y="5" width="${card.width}" height="${card.height}" rx="3" fill="#392b20" opacity=".24"/><rect class="case-card-paper" width="${card.width}" height="${card.height}" rx="3" fill="${card.selected ? '#fff2b9' : '#f1e5ca'}" stroke="${card.selected ? '#174f42' : '#b5a080'}" stroke-width="${card.selected ? 4 : 1}"/><path d="M0 15H${card.width}" stroke="#d5c19c"/><circle cx="${card.width / 2}" cy="5" r="6" fill="${card.selected ? '#1b6c58' : '#a14630'}"/><text x="12" y="37" fill="#282b26" font-size="17" font-weight="700">${caseLines(
        card.label,
      )
        .map((line, i) => `<tspan x="12" dy="${i ? 20 : 0}">${caseEscape(line)}</tspan>`)
        .join(
          '',
        )}</text><text x="12" y="82" fill="#414237" font-size="12">${caseEscape(countLine(card))}</text>${stripe}<text x="${card.width - 12}" y="14" text-anchor="end" font-size="11" fill="#33463c">${card.pinned ? '★' : card.recordId ? 'FILE' : 'OPEN +'}</text></g>`;
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" class="case-svg" viewBox="0 0 ${board.width} ${board.height}" aria-label="${caseEscape(board.title)}" role="group"><defs><pattern id="case-cork" width="18" height="18" patternUnits="userSpaceOnUse"><rect width="18" height="18" fill="#9b805b"/><path d="M2 4h2M12 9h3M7 15h2" stroke="#816947" stroke-width="1" opacity=".4"/></pattern></defs><rect width="100%" height="100%" fill="url(#case-cork)"/>${threads}${cards}${board.cards.length ? '' : `<text x="${board.width / 2}" y="${board.height / 2}" text-anchor="middle" fill="#fff5dc" font-size="22">No matching records · try Whole case</text>`}</svg>`;
}

export function paintCaseBoard(
  ctx: CanvasRenderingContext2D,
  board: CaseBoard,
  width: number,
  height: number,
) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#9b805b';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(63,42,21,.12)';
  for (let i = 0; i < 3000; i++) ctx.fillRect((i * 71.31) % width, (i * 37.97) % height, 2, 1);
  const scale = Math.min(width / board.width, height / board.height),
    offsetX = (width - board.width * scale) / 2,
    offsetY = (height - board.height * scale) / 2;
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  const byId = new Map(board.cards.map((card) => [card.id, card])),
    selected = board.cards.some((card) => card.selected);
  for (const thread of board.threads) {
    const p = caseCurve(byId.get(thread.from)!, byId.get(thread.to)!),
      style = threadStyle(thread, selected);
    ctx.globalAlpha = style.opacity;
    ctx.strokeStyle = ctx.fillStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.setLineDash(style.dash);
    ctx.beginPath();
    ctx.moveTo(p.x1, p.y1);
    ctx.lineJoin = 'round';
    p.points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
    ctx.stroke();
    ctx.setLineDash([]);
    if (thread.kind !== 'relates_to') {
      const angle = Math.atan2(p.y2 - p.c2y, p.x2 - p.c2x),
        dx = Math.cos(angle),
        dy = Math.sin(angle);
      ctx.beginPath();
      ctx.moveTo(p.x2, p.y2);
      ctx.lineTo(p.x2 - 10 * dx + 5 * dy, p.y2 - 10 * dy - 5 * dx);
      ctx.lineTo(p.x2 - 10 * dx - 5 * dy, p.y2 - 10 * dy + 5 * dx);
      ctx.fill();
    }
    if (thread.count > 1) {
      const x = p.labelX,
        y = p.labelY;
      ctx.fillStyle = '#f1e5ca';
      ctx.fillRect(x - 13, y - 10, 26, 20);
      ctx.fillStyle = '#302b23';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(thread.count), x, y + 4);
    }
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
  for (const card of board.cards) {
    const { x, y, width: w, height: h } = card;
    ctx.fillStyle = 'rgba(35,24,15,.25)';
    ctx.fillRect(x + 3, y + 5, w, h);
    ctx.fillStyle = card.selected ? '#fff2b9' : '#f1e5ca';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = card.selected ? '#174f42' : '#b5a080';
    ctx.lineWidth = card.selected ? 4 : 1;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = card.selected ? '#1b6c58' : '#a14630';
    ctx.beginPath();
    ctx.arc(x + w / 2, y + 5, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#282b26';
    ctx.font = 'bold 17px monospace';
    caseLines(card.label).forEach((line, i) => ctx.fillText(line, x + 12, y + 37 + i * 20));
    ctx.fillStyle = '#414237';
    ctx.font = '12px sans-serif';
    ctx.fillText(countLine(card), x + 12, y + 82);
    let at = 0;
    for (const mark of Object.keys(caseMarks) as CaseMark[]) {
      const stripe = ((w - 24) * card.counts[mark]) / card.counts.total;
      ctx.fillStyle = caseMarks[mark].ink;
      ctx.fillRect(x + 12 + at, y + h - 22, stripe, 8);
      at += stripe;
    }
    ctx.fillStyle = '#33463c';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(card.pinned ? '★' : card.recordId ? 'FILE' : 'OPEN +', x + w - 12, y + 14);
    ctx.textAlign = 'left';
  }
  if (!board.cards.length) {
    ctx.fillStyle = '#fff5dc';
    ctx.font = '22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(
      'No matching records · Whole case resets the view',
      board.width / 2,
      board.height / 2,
    );
  }
  ctx.restore();
  return { scale, offsetX, offsetY };
}
