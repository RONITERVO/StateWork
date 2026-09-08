import { z } from 'zod';
import type { Observation } from '@statework/core';
import { parse, zoneSchema } from './schemas.js';

export const perceptionProfileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  output: z
    .array(z.string().regex(/^[a-z][a-z0-9./-]{0,79}$/))
    .min(1)
    .max(20),
  input: z
    .array(z.string().regex(/^[a-z][a-z0-9./-]{0,79}$/))
    .min(1)
    .max(20),
  detail: z.enum(['brief', 'standard', 'expanded']),
  motion: z.enum(['none', 'reduced', 'full']),
  contrast: z.enum(['standard', 'high']),
  language: z.string().min(2).max(35),
  timeZone: zoneSchema,
  maxItems: z.number().int().min(1).max(500),
  textScale: z.number().min(1).max(2).default(1),
});
export type PerceptionProfile = z.infer<typeof perceptionProfileSchema>;
export const defaultProfile: PerceptionProfile = {
  schemaVersion: 1,
  output: ['text', 'visual'],
  input: ['keyboard', 'pointer'],
  detail: 'standard',
  motion: 'reduced',
  contrast: 'standard',
  language: 'en',
  timeZone: 'UTC',
  maxItems: 100,
  textScale: 1,
};
/** Trusted code registered by the host. Untrusted JSON cannot load an adapter. */
export interface PerceptionAdapter<T> {
  id: string;
  contractVersion: 1;
  output: string[];
  input: string[];
  requires: string[];
  render(observation: Observation, profile: PerceptionProfile): T;
}
export function negotiate<T>(
  adapter: PerceptionAdapter<T>,
  input: unknown,
  availableCapabilities: string[] = [],
): { supported: boolean; reasons: string[]; profile: PerceptionProfile } {
  const profile = parse(perceptionProfileSchema, input);
  const reasons: string[] = [];
  if (adapter.contractVersion !== 1) reasons.push('Unsupported adapter contract version.');
  if (!adapter.output.some((v) => profile.output.includes(v)))
    reasons.push('No preferred output channel is supported.');
  if (!adapter.input.some((v) => profile.input.includes(v)))
    reasons.push('No preferred input method is supported.');
  for (const capability of adapter.requires)
    if (!availableCapabilities.includes(capability))
      reasons.push(`Missing capability: ${capability}.`);
  return { supported: !reasons.length, reasons, profile };
}
export const textAdapter: PerceptionAdapter<string> = {
  id: 'statework/text',
  contractVersion: 1,
  output: ['text', 'speech', 'braille'],
  input: ['keyboard', 'switch', 'agent'],
  requires: [],
  render: (observation, profile) => {
    const lines = observation.nodes
      .slice(0, profile.maxItems)
      .map((node, index) =>
        profile.detail === 'brief'
          ? `${index + 1}. ${node.label}`
          : `${index + 1}. ${node.summary}${profile.detail === 'expanded' ? `\n${node.facts.map((f) => `   ${f.label}: ${f.value}`).join('\n')}` : ''}`,
      );
    return `${observation.workspace.title}\n${observation.total} matching items; revision ${observation.workspace.revision}.\n${lines.join('\n')}`;
  },
};
export interface SpatialProjection {
  nodes: { id: string; label: string; position: [number, number, number]; summary: string }[];
  links: { from: string; to: string; kind: string }[];
}
export const spatialAdapter: PerceptionAdapter<SpatialProjection> = {
  id: 'statework/spatial',
  contractVersion: 1,
  output: ['visual', 'spatial'],
  input: ['keyboard', 'pointer', 'gaze'],
  requires: [],
  render: (observation, profile) => {
    const selected = observation.nodes.slice(0, profile.maxItems),
      ids = new Set(selected.map((n) => n.id));
    return {
      nodes: selected.map((n, i) => ({
        id: n.id,
        label: n.label,
        summary: n.summary,
        position: [
          Math.cos(i * 2.399963229728653) * Math.sqrt(i + 1),
          Math.sin(i * 2.399963229728653) * Math.sqrt(i + 1),
          (n.facts.find((f) => f.key === 'priority')?.value as number) ?? 0,
        ],
      })),
      links: selected.flatMap((n) =>
        n.relationships
          .filter((r) => r.direction === 'outgoing' && ids.has(r.targetId))
          .map((r) => ({ from: n.id, to: r.targetId, kind: r.kind })),
      ),
    };
  },
};
/** Hardware adapters consume semantic cues; delivery must always be opt-in. */
export function cueFor(node: Observation['nodes'][number]) {
  return {
    id: node.id,
    text: node.summary,
    category: node.facts.some((f) => f.key === 'blocked' && f.value === true) ? 'waiting' : 'item',
    interrupt: false as const,
  };
}
