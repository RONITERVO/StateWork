import { mkdirSync, writeFileSync } from 'node:fs';
import { openapi } from '@statework/server';
import { jsonSchema, requestSchema, snapshotSchema, perceptionProfileSchema } from '@statework/sdk';
mkdirSync('schemas', { recursive: true });
for (const [name, schema] of Object.entries({
  openapi: openapi(),
  'command-request.schema': jsonSchema(requestSchema),
  'snapshot.schema': jsonSchema(snapshotSchema),
  'perception-profile.schema': jsonSchema(perceptionProfileSchema),
}))
  writeFileSync(`schemas/${name}.json`, JSON.stringify(schema, null, 2) + '\n');
console.log('Exported versioned OpenAPI and JSON Schema contracts.');
