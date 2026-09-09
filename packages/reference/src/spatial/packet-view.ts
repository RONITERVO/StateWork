import { latestPacket, packetIssues } from '@statework/sdk';
import type { WorkState } from '@statework/sdk';
export interface PacketDeskView {
  open: boolean;
  title: string;
  body: string;
  position: string;
  step: number;
  page: number;
  pages: number;
  steps: number;
  canCheck: boolean;
  checked: boolean;
  packetId: string | null;
  stepId: string | null;
}
export function packetDeskView(
  state: WorkState,
  taskId: string,
  stepIndex: number,
  pageIndex: number,
  open: boolean,
  writable: boolean,
): PacketDeskView {
  const packet = latestPacket(state, taskId);
  const step = Math.max(0, Math.min(stepIndex, (packet?.steps.length ?? 1) - 1));
  const current = packet?.steps[step];
  const issues = packet ? packetIssues(state, packet) : [];
  const content = current
    ? `${current.title}\n\nDO\n${current.instruction}\n\nCHECK\n${current.expected}\n\nIF STUCK\n${current.ifBlocked}\n\n${current.actionUrl ? `OPEN\n${current.actionUrl}\n\n` : ''}SOURCES\n${current.citations.map((c) => `${state.instructions?.sources.find((s) => s.id === c.sourceId)?.title ?? c.sourceId} · ${c.location}\n${c.quote}`).join('\n\n')}`
    : 'Choose Open / Print to build precise instructions from this task and its sources.';
  // Every character is available: long instructions and references are paged, never abbreviated.
  const lines: string[] = [];
  for (const paragraph of content.split('\n')) {
    let chars = Array.from(paragraph);
    while (chars.length > 24) {
      const space = chars.slice(0, 24).lastIndexOf(' ');
      const cut = space > 0 ? space + 1 : 24;
      lines.push(chars.slice(0, cut).join(''));
      chars = chars.slice(cut);
    }
    lines.push(chars.join(''));
  }
  const pages: string[] = [];
  for (let i = 0; i < lines.length; i += 8) pages.push(lines.slice(i, i + 8).join('\n'));
  const page = Math.max(0, Math.min(pageIndex, pages.length - 1));
  return {
    open,
    title: packet
      ? issues.length
        ? 'NEEDS ATTENTION'
        : 'WORK INSTRUCTIONS'
      : 'BUILD INSTRUCTIONS',
    body: pages[page] ?? '',
    position: `STEP ${step + 1}/${packet?.steps.length ?? 0} · PAGE ${page + 1}/${pages.length}`,
    step,
    page,
    pages: pages.length,
    steps: packet?.steps.length ?? 0,
    canCheck:
      !!packet &&
      writable &&
      !issues.length &&
      page === pages.length - 1 &&
      packet.steps.slice(0, step).every((s) => packet.checks.some((c) => c.stepId === s.id)),
    checked: !!current && !!packet?.checks.some((c) => c.stepId === current.id),
    packetId: packet?.id ?? null,
    stepId: current?.id ?? null,
  };
}
