import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { extractSource, fetchSource, packetResearchBrief } from '@statework/node';
import type { PacketAssistant } from '@statework/node';
import { WorkError, idSchema, parse, sourceExtractSchema, sourceFetchSchema } from '@statework/sdk';
import type { WorkConnection, PacketInput } from '@statework/sdk';

export async function instructionRoutes(
  api: FastifyInstance,
  connection: (header: string | undefined) => WorkConnection,
  assistant?: PacketAssistant,
) {
  const jobs = new Map<
    string,
    {
      workspace: string;
      actor: string;
      taskId: string;
      at: number;
      controller: AbortController;
      state: 'running' | 'done' | 'failed' | 'cancelled';
      packet?: PacketInput;
      error?: string;
    }
  >();
  api.addHook('onClose', async () => {
    for (const job of jobs.values()) job.controller.abort();
    jobs.clear();
  });
  const editor = (header: string | undefined, id: string) => {
    const c = connection(header);
    if (c.role(id) === 'reader')
      throw new WorkError(
        'FORBIDDEN',
        'A writer connection is required for source capture and assistance.',
      );
    return c;
  };
  api.get<{ Params: { id: string; taskId: string } }>(
    '/workspaces/:id/instructions/:taskId',
    async (r) => connection(r.headers.authorization).instructions(r.params.id, r.params.taskId),
  );
  api.get<{ Params: { id: string; taskId: string } }>(
    '/workspaces/:id/instructions/:taskId/prompt',
    async (r) => ({
      prompt: packetResearchBrief(
        connection(r.headers.authorization).instructions(r.params.id, r.params.taskId).context,
      ),
    }),
  );
  api.get<{ Params: { id: string } }>('/workspaces/:id/assistant', async (r) => {
    connection(r.headers.authorization).role(r.params.id);
    return (
      assistant?.status() ?? {
        available: false,
        name: 'No assistant configured',
        message: 'The manual editor is ready. A host can enable a local Codex adapter.',
      }
    );
  });
  api.post<{ Params: { id: string; taskId: string } }>(
    '/workspaces/:id/instructions/:taskId/draft',
    async (r, reply) => {
      const c = editor(r.headers.authorization, r.params.id);
      if (!assistant?.status().available)
        throw new WorkError(
          'NOT_FOUND',
          'Codex is unavailable. Use the manual editor or configure the local CLI.',
        );
      for (const [id, job] of jobs)
        if (Date.now() - job.at > 1800000) {
          job.controller.abort();
          jobs.delete(id);
        }
      // Bound retained proposals as well as active processes. Insertion order evicts oldest first.
      for (const [id, job] of jobs) {
        if (jobs.size < 32) break;
        if (job.state !== 'running') jobs.delete(id);
      }
      if (
        [...jobs.values()].filter((j) => j.state === 'running').length >= 4 ||
        [...jobs.values()].some((j) => j.actor === c.actorId && j.state === 'running')
      )
        throw new WorkError('CONFLICT', 'A draft is already running. Wait or cancel it.');
      const context = c.instructions(r.params.id, r.params.taskId).context;
      const id = randomUUID();
      const job = {
        workspace: r.params.id,
        actor: c.actorId,
        taskId: r.params.taskId,
        at: Date.now(),
        controller: new AbortController(),
        state: 'running' as 'running' | 'done' | 'failed' | 'cancelled',
        packet: undefined as PacketInput | undefined,
        error: undefined as string | undefined,
      };
      jobs.set(id, job);
      void assistant.draft(context, job.controller.signal).then(
        (packet) => {
          if (job.state === 'running') {
            job.packet = packet;
            job.state = 'done';
          }
        },
        (error) => {
          if (job.state === 'running') {
            job.state = 'failed';
            job.error =
              error instanceof WorkError
                ? error.message
                : 'Draft failed. Your manual work is unchanged.';
          }
        },
      );
      return reply.code(202).send({ id, state: job.state });
    },
  );
  const getJob = (header: string | undefined, workspace: string, id: string) => {
    const c = editor(header, workspace);
    parse(idSchema, id);
    const job = jobs.get(id);
    if (!job || job.workspace !== workspace || job.actor !== c.actorId)
      throw new WorkError('NOT_FOUND', 'Draft is unavailable or expired.');
    return job;
  };
  api.get<{ Params: { id: string; jobId: string } }>('/workspaces/:id/drafts/:jobId', async (r) => {
    const job = getJob(r.headers.authorization, r.params.id, r.params.jobId);
    return { state: job.state, packet: job.packet ?? null, error: job.error ?? null };
  });
  api.delete<{ Params: { id: string; jobId: string } }>(
    '/workspaces/:id/drafts/:jobId',
    async (r) => {
      const job = getJob(r.headers.authorization, r.params.id, r.params.jobId);
      job.controller.abort();
      job.state = 'cancelled';
      job.packet = undefined;
      return { state: job.state };
    },
  );
  api.post<{ Params: { id: string } }>(
    '/workspaces/:id/sources/extract',
    { bodyLimit: 12 * 1024 * 1024 },
    async (r) => {
      editor(r.headers.authorization, r.params.id);
      const input = parse(sourceExtractSchema, r.body);
      const bytes = Buffer.from(input.base64, 'base64');
      if (bytes.toString('base64') !== input.base64)
        throw new WorkError('VALIDATION', 'File encoding is invalid.');
      return extractSource(input.name, new Uint8Array(bytes));
    },
  );
  api.post<{ Params: { id: string } }>('/workspaces/:id/sources/fetch', async (r) => {
    editor(r.headers.authorization, r.params.id);
    const { url } = parse(sourceFetchSchema, r.body);
    const result = await fetchSource(url);
    if (result.contentType.includes('application/pdf'))
      return { ...(await extractSource('source.pdf', result.bytes)), url: result.url, html: false };
    if (!/text\/(html|plain)|application\/(json|xhtml\+xml)/i.test(result.contentType))
      throw new WorkError(
        'VALIDATION',
        'This source type needs a downloaded file or a readable text capture.',
      );
    const content = new TextDecoder('utf-8', { fatal: true }).decode(result.bytes);
    if (content.length > 180000)
      throw new WorkError(
        'LIMIT',
        'Page exceeds 180,000 characters. Paste the relevant named section.',
      );
    return {
      content,
      url: result.url,
      html: /html/i.test(result.contentType),
      warnings: [
        'Check the result: public capture has no signed-in browser session. Check diagrams and dynamic content.',
      ],
    };
  });
}
