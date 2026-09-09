import { z } from 'zod';
import { instructionUrl } from '@statework/core';
import { FILE_LIMIT, FILE_BASE64_LIMIT } from './files.js';

// Kept independent of schemas.ts so the command union can include these contracts.
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/);
const text = z.string().max(12000);
const label = z.string().trim().min(1).max(240);
const instant = z.string().refine((s) => {
  const d = new Date(s);
  return Number.isFinite(d.getTime()) && d.toISOString() === s && s.length === 24;
});
const ids = (max: number) =>
  z
    .array(id)
    .max(max)
    .refine((v) => new Set(v).size === v.length, 'IDs must be unique.');
const url = z
  .string()
  .max(2048)
  .refine((s) => {
    if (s === '') return true;
    if (!instructionUrl(s)) return false;
    try {
      new URL(s);
      return true;
    } catch {
      return false;
    }
  }, 'Use an HTTP, HTTPS or mailto link without embedded credentials.');
export const assetInputSchema = z.strictObject({
  id,
  taskIds: ids(100).min(1),
  name: label.refine(
    (s) => !/[\\/\u0000-\u001f]/.test(s) && s !== '.' && s !== '..',
    'Use a filename without directories.',
  ),
  mediaType: z
    .string()
    .max(120)
    .regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/),
  size: z.number().int().min(0).max(FILE_LIMIT),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  description: text,
  locator: z.string().max(2048),
  replaces: id.nullable(),
});
export const workAssetSchema = assetInputSchema.extend({
  capturedAt: instant,
  capturedBy: id,
  archive: z.strictObject({ at: instant, by: id, reason: text.trim().min(1) }).optional(),
});
export const workReferenceSchema = z.strictObject({
  id,
  label,
  kind: z.enum(['source', 'asset', 'external']),
  targetId: id.nullable(),
  url,
  location: z.string().max(1000),
  page: z.number().int().min(1).max(100000).nullable(),
  seconds: z.number().min(0).max(31536000).nullable(),
  essential: z.boolean(),
  purpose: z.enum(['instruction', 'input', 'example']),
});
export const executionContractSchema = z.strictObject({
  version: z.literal(1),
  completion: z.strictObject({ anyOf: ids(100) }),
  coverage: z.strictObject({
    inputs: z.enum(['unknown', 'checked']),
    procedure: z.enum(['unknown', 'checked']),
    acceptance: z.enum(['unknown', 'checked']),
    note: text,
  }),
  outputs: z
    .array(z.strictObject({ id, label, description: text, stepId: id, required: z.boolean() }))
    .max(100)
    .refine((v) => new Set(v.map((x) => x.id)).size === v.length, 'Output IDs must be unique.'),
});
const resultOutputs = z
  .array(z.strictObject({ outputId: id, assetId: id }))
  .max(100)
  .refine((v) => new Set(v.map((x) => x.outputId)).size === v.length, 'Output IDs must be unique.');
export const workerEnvironmentSchema = z.strictObject({
  externalAccess: z.boolean().optional(),
  availableAssetIds: ids(2000).optional(),
});
export const assetUploadSchema = z.strictObject({
  requestId: id,
  expectedRevision: z.number().int().min(0),
  asset: assetInputSchema.omit({ size: true, sha256: true }),
  base64: z.string().max(FILE_BASE64_LIMIT),
});
export const assetRestoreSchema = z.strictObject({ base64: z.string().max(FILE_BASE64_LIMIT) });
export const sourceInputSchema = z.strictObject({
  id,
  taskIds: ids(100).min(1),
  title: label,
  locator: z.string().trim().min(1).max(2048),
  content: z.string().max(180000),
  kind: z.enum(['page', 'file', 'email', 'note']),
  coverage: z.enum(['complete', 'excerpt', 'unreadable']),
  replaces: id.nullable(),
  assetId: id.optional(),
});
export const workSourceSchema = sourceInputSchema.extend({ capturedAt: instant, capturedBy: id });
export const citationSchema = z.strictObject({
  sourceId: id,
  quote: z.string().max(12000),
  location: z.string().max(1000),
});
const citations = z.array(citationSchema).max(20);
export const packetRequirementSchema = z.strictObject({
  id,
  label,
  detail: text,
  kind: z.enum(['task', 'account', 'software', 'person', 'material', 'information']),
  itemId: id.nullable(),
  url,
  check: text,
  confirmed: z.boolean(),
  citations,
  scope: z.enum(['worker', 'workspace']).optional(),
});
export const packetStepSchema = z.strictObject({
  id,
  title: label,
  instruction: text,
  expected: text,
  ifBlocked: text,
  minutes: z.number().int().min(0).max(525600).nullable(),
  actionUrl: url,
  requires: ids(100),
  citations,
  after: ids(100).optional(),
  phase: z.enum(['prepare', 'work', 'verify', 'deliver']).optional(),
  references: z
    .array(workReferenceSchema)
    .max(100)
    .refine((v) => new Set(v.map((x) => x.id)).size === v.length, 'Reference IDs must be unique.')
    .optional(),
  when: z.strictObject({ stepId: id, optionId: id }).optional(),
  decision: z
    .strictObject({
      prompt: text,
      options: z
        .array(z.strictObject({ id, label }))
        .min(2)
        .max(20)
        .refine(
          (v) => new Set(v.map((x) => x.id)).size === v.length,
          'Decision option IDs must be unique.',
        ),
    })
    .optional(),
  evidenceRequired: z.boolean().optional(),
});
export const packetQuestionSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/),
  question: label,
  resolve: text,
  url,
  answer: text,
  citations,
});
const unique = <T extends { id: string }>(items: T[]) =>
  new Set(items.map((i) => i.id)).size === items.length;
export const packetInputSchema = z.strictObject({
  id,
  taskId: id,
  contextKey: z.string().regex(/^[a-f0-9]{16}$/),
  title: label,
  outcome: text,
  requirements: z
    .array(packetRequirementSchema)
    .max(100)
    .refine(unique, 'Requirement IDs must be unique.'),
  steps: z.array(packetStepSchema).max(100).refine(unique, 'Step IDs must be unique.'),
  finish: text,
  questions: z.array(packetQuestionSchema).max(200).refine(unique, 'Question IDs must be unique.'),
  sourceIds: ids(2000),
  origin: z.enum(['manual', 'codex', 'import']),
  execution: executionContractSchema.optional(),
});
export const workPacketSchema = packetInputSchema.extend({
  revision: z.number().int().positive(),
  createdAt: instant,
  createdBy: id,
  review: z.strictObject({ at: instant, by: id }).nullable(),
  checks: z
    .array(
      z.strictObject({
        stepId: id,
        at: instant,
        by: id,
        evidence: z.string().max(12000),
        choice: id.optional(),
        outputs: resultOutputs.optional(),
      }),
    )
    .max(100),
  confirmations: z
    .array(
      z.strictObject({
        requirementId: id,
        available: z.boolean(),
        evidence: text,
        at: instant,
        by: id,
      }),
    )
    .max(2000)
    .optional(),
});
export const instructionsSchema = z.strictObject({
  sources: z.array(workSourceSchema).max(2000),
  packets: z.array(workPacketSchema).max(2000),
  assets: z.array(workAssetSchema).max(2000).optional(),
});
export const instructionCommandSchemas = [
  z.strictObject({ type: z.literal('asset.register'), asset: assetInputSchema }),
  z.strictObject({
    type: z.literal('asset.archive'),
    id,
    archived: z.boolean(),
    reason: text.trim().min(1),
  }),
  z.strictObject({
    type: z.literal('asset.relink'),
    id,
    taskIds: ids(100).min(1),
    reason: text.trim().min(1),
  }),
  z.strictObject({ type: z.literal('source.capture'), source: sourceInputSchema }),
  z.strictObject({
    type: z.literal('packet.save'),
    packet: packetInputSchema,
    expectedPacketId: id.nullable(),
  }),
  z.strictObject({ type: z.literal('packet.review'), id }),
  z.strictObject({
    type: z.literal('packet.check'),
    id,
    stepId: id,
    checked: z.boolean(),
    evidence: text,
    choice: id.optional(),
    outputs: resultOutputs.optional(),
  }),
  z.strictObject({
    type: z.literal('packet.confirm'),
    id,
    requirementId: id,
    available: z.boolean(),
    evidence: text,
  }),
] as const;
export const sourceExtractSchema = z.strictObject({
  name: z.string().min(1).max(240),
  base64: z.string().max(11200000),
});
export const sourceFetchSchema = z.strictObject({ url: z.string().url().max(2048) });
