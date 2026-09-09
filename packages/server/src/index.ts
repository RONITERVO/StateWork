import Fastify from 'fastify';
import staticFiles from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import { WorkError } from '@statework/core';
import {
  createWorkspaceSchema,
  jsonSchema,
  observeSchema,
  planOptionsSchema,
  workPlanSchema,
  requestSchema,
  workStateSchema,
  commandResultSchema,
  observationResultSchema,
  workspaceListSchema,
  eventPageSchema,
  snapshotSchema,
  importSchema,
  errorSchema,
  parse,
} from '@statework/sdk';
import type { WorkService } from '@statework/sdk';
import { existsSync } from 'node:fs';
interface Options {
  service: WorkService;
  authenticate: (token: string) => string | undefined;
  staticRoot?: string;
  localToken?: string;
  port?: number;
}
export async function createServer(options: Options) {
  const app = Fastify({
    logger: false,
    bodyLimit: 1_048_576,
    requestTimeout: 15000,
    connectionTimeout: 15000,
  });
  await app.register(rateLimit, { max: 600, timeWindow: '1 minute' });
  const allowedHost = new Set([
    `127.0.0.1:${options.port ?? 4180}`,
    `localhost:${options.port ?? 4180}`,
  ]);
  app.addHook('onRequest', async (request, reply) => {
    reply
      .header('X-Content-Type-Options', 'nosniff')
      .header('Referrer-Policy', 'no-referrer')
      .header('X-Frame-Options', 'DENY')
      .header('Cache-Control', 'no-store');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    );
    if (!allowedHost.has(request.headers.host ?? ''))
      throw new WorkError('FORBIDDEN', 'Unrecognized host. Use the local loopback address.');
    if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`)
      throw new WorkError('FORBIDDEN', 'Cross-origin requests are not allowed.');
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof WorkError) {
      const status = {
        VALIDATION: 400,
        NOT_FOUND: 404,
        CONFLICT: 409,
        FORBIDDEN: 403,
        CYCLE: 422,
        BLOCKED: 422,
        LIMIT: 413,
        UNAUTHORIZED: 401,
      }[error.code];
      return reply
        .code(status)
        .send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    const e = error as { statusCode?: number };
    if (e.statusCode && e.statusCode < 500)
      return reply.code(e.statusCode).send({
        error: {
          code: 'VALIDATION',
          message:
            e.statusCode === 429
              ? 'Too many requests. Try again shortly.'
              : 'Invalid or oversized request.',
        },
      });
    request.log.error(error);
    return reply.code(500).send({
      error: { code: 'INTERNAL', message: 'The local service could not complete this request.' },
    });
  });
  app.get('/health', async () => ({
    status: 'ok',
    product: 'StateWork',
    version: '0.1.0',
    localOnly: true,
  }));
  // Same-origin browser bootstrap. Local processes are trusted; arbitrary websites are not.
  app.post('/local/session', async (request, reply) => {
    if (
      !options.localToken ||
      request.headers['x-statework-local'] !== '1' ||
      request.headers['sec-fetch-site'] !== 'same-origin' ||
      request.headers.origin !== `http://${request.headers.host}`
    )
      throw new WorkError('FORBIDDEN', 'Local sessions require a same-origin browser request.');
    if (!options.authenticate(options.localToken))
      throw new WorkError('UNAUTHORIZED', 'Local credential has been revoked.');
    return reply.send({ token: options.localToken });
  });
  await app.register(
    async (api) => {
      api.addHook('onRequest', async (request) => {
        const header = request.headers.authorization;
        if (!header?.startsWith('Bearer ') || !options.authenticate(header.slice(7)))
          throw new WorkError('UNAUTHORIZED', 'A valid local access token is required.');
      });
      const connection = (header: string | undefined) =>
        options.service.connect(options.authenticate(header!.slice(7))!);
      api.get('/workspaces', async (r) => connection(r.headers.authorization).list());
      api.post('/workspaces', async (r, reply) =>
        reply.code(201).send(connection(r.headers.authorization).create(r.body)),
      );
      api.get<{ Params: { id: string } }>('/workspaces/:id', async (r) =>
        connection(r.headers.authorization).snapshot(r.params.id),
      );
      api.post<{ Params: { id: string } }>('/workspaces/:id/commands', async (r) =>
        connection(r.headers.authorization).execute(r.params.id, r.body),
      );
      api.post<{ Params: { id: string } }>('/workspaces/:id/observe', async (r) =>
        connection(r.headers.authorization).observe(r.params.id, r.body ?? {}),
      );
      api.post<{ Params: { id: string } }>('/workspaces/:id/plan', async (r) =>
        connection(r.headers.authorization).plan(r.params.id, r.body),
      );
      api.get<{ Params: { id: string }; Querystring: { after?: string; limit?: string } }>(
        '/workspaces/:id/events',
        async (r) =>
          connection(r.headers.authorization).events(
            r.params.id,
            Number(r.query.after ?? 0),
            Number(r.query.limit ?? 100),
          ),
      );
      api.get<{ Params: { id: string } }>('/workspaces/:id/export', async (r, reply) =>
        reply
          .header('Content-Disposition', 'attachment; filename="statework-snapshot.json"')
          .send(connection(r.headers.authorization).export(r.params.id)),
      );
      api.post('/import', async (r, reply) => {
        const body = parse(importSchema, r.body);
        return reply
          .code(201)
          .send(connection(r.headers.authorization).import(body.snapshot, body.target));
      });
      api.get('/openapi.json', async () => openapi());
    },
    { prefix: '/v1' },
  );
  if (options.staticRoot && existsSync(options.staticRoot))
    await app.register(staticFiles, { root: options.staticRoot, index: 'index.html', maxAge: 0 });
  return app;
}
export function openapi() {
  const response = (schema: unknown, status = '200') => ({
    [status]: { description: 'Success', content: { 'application/json': { schema } } },
    ...Object.fromEntries(
      Object.entries({
        '400': 'Invalid request',
        '401': 'Invalid token',
        '403': 'Read-only or invalid origin',
        '404': 'Unavailable workspace',
        '409': 'Version or request ID conflict',
        '413': 'Payload limit',
        '422': 'Dependency invariant failed',
        '429': 'Rate limited',
        '500': 'Unexpected service error',
      }).map(([code, description]) => [
        code,
        {
          description,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
        },
      ]),
    ),
  });
  const definitions = {
    CommandRequest: requestSchema,
    WorkState: workStateSchema,
    CommandResult: commandResultSchema,
    Observation: observationResultSchema,
    WorkPlan: workPlanSchema,
    PlanOptions: planOptionsSchema,
    WorkspaceList: workspaceListSchema,
    EventPage: eventPageSchema,
    Snapshot: snapshotSchema,
    Import: importSchema,
    Error: errorSchema,
  };
  const schemas = Object.fromEntries(
    Object.entries(definitions).map(([name, definition]) => {
      const schema = jsonSchema(definition);
      // JSON Schema local definitions must point into the enclosing OpenAPI document.
      const rewrite = (node: unknown): void => {
        if (node && typeof node === 'object') {
          for (const [key, value] of Object.entries(node)) {
            if (key === '$ref' && typeof value === 'string' && value.startsWith('#/$defs/'))
              (node as Record<string, unknown>)[key] =
                `#/components/schemas/${name}/${value.slice(2)}`;
            else rewrite(value);
          }
        }
      };
      rewrite(schema);
      return [name, schema];
    }),
  );
  const pathParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };
  const body = (schema: unknown) => ({
    required: true,
    content: { 'application/json': { schema } },
  });
  return {
    openapi: '3.1.0',
    info: {
      title: 'StateWork local API',
      version: '0.1.0',
      description:
        'Local-only work graph. Schema refinements (real dates, IANA zones, acyclicity, completion rules) are enforced by the SDK in addition to JSON Schema.',
    },
    servers: [{ url: '/v1' }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
      schemas,
    },
    paths: {
      '/workspaces': {
        get: {
          operationId: 'listWorkspaces',
          responses: response({ $ref: '#/components/schemas/WorkspaceList' }),
        },
        post: {
          operationId: 'createWorkspace',
          requestBody: body(jsonSchema(createWorkspaceSchema)),
          responses: response({ $ref: '#/components/schemas/WorkState' }, '201'),
        },
      },
      '/workspaces/{id}': {
        parameters: [pathParam],
        get: {
          operationId: 'getWorkspace',
          responses: response({ $ref: '#/components/schemas/WorkState' }),
        },
      },
      '/workspaces/{id}/commands': {
        parameters: [pathParam],
        post: {
          operationId: 'executeCommands',
          requestBody: body({ $ref: '#/components/schemas/CommandRequest' }),
          responses: response({ $ref: '#/components/schemas/CommandResult' }),
        },
      },
      '/workspaces/{id}/observe': {
        parameters: [pathParam],
        post: {
          operationId: 'observe',
          requestBody: body(jsonSchema(observeSchema)),
          responses: response({ $ref: '#/components/schemas/Observation' }),
        },
      },
      '/workspaces/{id}/events': {
        parameters: [pathParam],
        get: {
          operationId: 'events',
          parameters: [
            { name: 'after', in: 'query', schema: { type: 'integer', minimum: 0 } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500 } },
          ],
          responses: response({ $ref: '#/components/schemas/EventPage' }),
        },
      },
      '/workspaces/{id}/plan': {
        parameters: [pathParam],
        post: {
          operationId: 'planWork',
          description: 'Read-only day recommendations. Projections never change work records.',
          requestBody: body({ $ref: '#/components/schemas/PlanOptions' }),
          responses: response({ $ref: '#/components/schemas/WorkPlan' }),
        },
      },
      '/workspaces/{id}/export': {
        parameters: [pathParam],
        get: {
          operationId: 'exportWorkspace',
          responses: response({ $ref: '#/components/schemas/Snapshot' }),
        },
      },
      '/import': {
        post: {
          operationId: 'importWorkspace',
          requestBody: body({ $ref: '#/components/schemas/Import' }),
          responses: response({ $ref: '#/components/schemas/WorkState' }, '201'),
        },
      },
    },
  };
}
