import { mkdirSync, writeFileSync } from 'node:fs';
import { openapi } from '@statework/server';
import {
  jsonSchema,
  requestSchema,
  snapshotSchema,
  perceptionProfileSchema,
  packetInputSchema,
  sourceInputSchema,
  workerHandoffSchema,
  fileBundleSchema,
  filePackageSchema,
  workBriefSchema,
  workStepSchema,
  sourceReadResultSchema,
  calendarComparisonResultSchema,
} from '@statework/sdk';
mkdirSync('schemas', { recursive: true });
for (const [name, schema] of Object.entries({
  openapi: openapi(),
  'command-request.schema': jsonSchema(requestSchema),
  'snapshot.schema': jsonSchema(snapshotSchema),
  'perception-profile.schema': jsonSchema(perceptionProfileSchema),
  'work-packet.schema': jsonSchema(packetInputSchema),
  'source-capture.schema': jsonSchema(sourceInputSchema),
  'worker-handoff.schema': jsonSchema(workerHandoffSchema),
  'file-bundle.schema': jsonSchema(fileBundleSchema),
  'file-package.schema': jsonSchema(filePackageSchema),
  'work-brief.schema': jsonSchema(workBriefSchema),
  'work-step.schema': jsonSchema(workStepSchema),
  'source-read.schema': jsonSchema(sourceReadResultSchema),
  'calendar-comparison.schema': jsonSchema(calendarComparisonResultSchema),
}))
  writeFileSync(`schemas/${name}.json`, JSON.stringify(schema, null, 2) + '\n');
console.log('Exported versioned OpenAPI and JSON Schema contracts.');
