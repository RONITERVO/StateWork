import type { PacketContext, PacketInput } from './instructions.js';
import { validateExecution } from './execution.js';

/** Repair references, never missing domain facts. Every repair remains an unanswered gap. */
export function reconcilePacketProposal(context: PacketContext, input: PacketInput): PacketInput {
  const packet: PacketInput = JSON.parse(JSON.stringify(input));
  packet.taskId = context.task.id;
  packet.contextKey = packet.execution ? context.procedureKey! : context.key;
  const captures = new Map(context.sources.map((s) => [s.id, s]));
  const question = (id: string, label: string, resolve: string, url = '') => {
    id = id.slice(0, 159);
    const existing = packet.questions.find((q) => q.id === id);
    if (existing) {
      existing.answer = '';
      existing.citations = [];
      return;
    }
    if (packet.questions.length >= 200) packet.questions.pop();
    packet.questions.push({
      id,
      question: label.slice(0, 240),
      resolve,
      url,
      answer: '',
      citations: [],
    });
  };
  packet.sourceIds = packet.sourceIds.filter((id) => captures.has(id));
  for (const part of [...packet.steps, ...packet.requirements, ...packet.questions]) {
    const count = part.citations.length;
    part.citations = part.citations.filter(
      (c) =>
        captures.get(c.sourceId)?.content.includes(c.quote) && c.quote.trim() && c.location.trim(),
    );
    for (const c of part.citations)
      if (!packet.sourceIds.includes(c.sourceId)) packet.sourceIds.push(c.sourceId);
    if (count !== part.citations.length)
      question(
        `evidence-${part.id}`,
        'Supporting evidence is missing.',
        'Capture the exact instruction or specification for this part. Invalid generated citations were removed.',
      );
  }
  const forbidden = new Set([context.task.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of context.relations)
      if (
        (r.kind === 'contains' || r.kind === 'depends_on') &&
        forbidden.has(r.to) &&
        !forbidden.has(r.from)
      ) {
        forbidden.add(r.from);
        changed = true;
      }
  }
  for (const r of packet.requirements) {
    r.confirmed = false;
    if (r.itemId && (forbidden.has(r.itemId) || !context.items.some((i) => i.id === r.itemId))) {
      r.itemId = null;
      question(
        `requirement-${r.id}`,
        `Clarify prerequisite: ${r.label}`,
        'Identify the real prerequisite. A task cannot require itself, its enclosing project or a dependent task.',
      );
    }
  }
  for (const step of packet.steps) {
    if (!step.citations.length)
      question(
        `evidence-${step.id}`,
        `Evidence needed: ${step.title}`,
        'Read and capture the actual procedure, inputs, settings and acceptance criteria before treating this as executable work.',
      );
    for (const ref of step.references ?? []) {
      if (
        (ref.kind === 'source' && !captures.has(ref.targetId ?? '')) ||
        (ref.kind === 'asset' && !context.assets?.some((a) => a.id === ref.targetId))
      )
        question(
          `reference-${step.id}-${ref.id}`.slice(0, 159),
          `Reference needed: ${ref.label}`,
          'Attach or capture the exact referenced contents. A generated reference is not an existing file.',
        );
    }
  }
  if (packet.execution) {
    // A model proposal cannot attest that a human or domain reviewer checked coverage.
    packet.execution.coverage.inputs = 'unknown';
    packet.execution.coverage.procedure = 'unknown';
    packet.execution.coverage.acceptance = 'unknown';
  }
  validateExecution(packet);
  return packet;
}
