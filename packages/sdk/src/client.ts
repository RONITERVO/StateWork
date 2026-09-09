import { WorkError } from '@statework/core';
import type {
  CommandRequest,
  CommandResult,
  DomainEvent,
  Observation,
  Query,
  Role,
  WorkState,
  PlanOptions,
  WorkPlan,
  PacketContext,
  WorkPacket,
  PacketIssue,
} from '@statework/core';
export class WorkClient {
  constructor(
    private baseUrl: string,
    private token: string,
    private fetcher: typeof fetch = fetch,
  ) {}
  private async call<T>(
    path: string,
    body?: unknown,
    method?: string,
    timeoutMs = 15000,
  ): Promise<T> {
    const fetcher = this.fetcher;
    const response = await fetcher(`${this.baseUrl.replace(/\/$/, '')}/v1${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok)
      throw new WorkError(
        data.error?.code ?? 'VALIDATION',
        data.error?.message ?? `HTTP ${response.status}`,
        data.error?.details,
      );
    return data as T;
  }
  list() {
    return this.call<{ id: string; title: string; revision: number; role: Role }[]>('/workspaces');
  }
  create(input: { id: string; title: string }) {
    return this.call<WorkState>('/workspaces', input);
  }
  snapshot(id: string) {
    return this.call<WorkState>(`/workspaces/${encodeURIComponent(id)}`);
  }
  async execute(id: string, request: CommandRequest): Promise<CommandResult> {
    const path = `/workspaces/${encodeURIComponent(id)}/commands`;
    try {
      return await this.call<CommandResult>(path, request);
    } catch (error) {
      if (error instanceof WorkError) throw error;
      return this.call<CommandResult>(path, request);
    }
  }
  observe(id: string, input: { query?: Query; offset?: number; limit?: number } = {}) {
    return this.call<Observation>(`/workspaces/${encodeURIComponent(id)}/observe`, input);
  }
  events(id: string, after = 0, limit = 100) {
    return this.call<{ events: DomainEvent[]; nextCursor: number; revision: number }>(
      `/workspaces/${encodeURIComponent(id)}/events?after=${after}&limit=${limit}`,
    );
  }
  plan(id: string, options: PlanOptions) {
    return this.call<WorkPlan>(`/workspaces/${encodeURIComponent(id)}/plan`, options);
  }
  instructions(id: string, taskId: string) {
    return this.call<{
      context: PacketContext;
      packet: WorkPacket | null;
      issues: PacketIssue[];
      history: { id: string; revision: number; createdAt: string; review: WorkPacket['review'] }[];
    }>(`/workspaces/${encodeURIComponent(id)}/instructions/${encodeURIComponent(taskId)}`);
  }
  instructionPrompt(id: string, taskId: string) {
    return this.call<{ prompt: string }>(
      `/workspaces/${encodeURIComponent(id)}/instructions/${encodeURIComponent(taskId)}/prompt`,
    );
  }
  assistant(id: string) {
    return this.call<{ available: boolean; name: string; message: string }>(
      `/workspaces/${encodeURIComponent(id)}/assistant`,
    );
  }
  draftInstructions(id: string, taskId: string) {
    return this.call<{ id: string; state: string }>(
      `/workspaces/${encodeURIComponent(id)}/instructions/${encodeURIComponent(taskId)}/draft`,
      {},
    );
  }
  draftStatus(id: string, jobId: string) {
    return this.call<{
      state: 'running' | 'done' | 'failed' | 'cancelled';
      packet: import('@statework/core').PacketInput | null;
      error: string | null;
    }>(`/workspaces/${encodeURIComponent(id)}/drafts/${encodeURIComponent(jobId)}`);
  }
  cancelDraft(id: string, jobId: string) {
    return this.call(
      `/workspaces/${encodeURIComponent(id)}/drafts/${encodeURIComponent(jobId)}`,
      undefined,
      'DELETE',
    );
  }
  extractSource(id: string, name: string, base64: string) {
    return this.call<{ content: string; warnings: string[] }>(
      `/workspaces/${encodeURIComponent(id)}/sources/extract`,
      { name, base64 },
      undefined,
      45000,
    );
  }
  fetchSource(id: string, url: string) {
    return this.call<{ content: string; warnings: string[]; url: string; html: boolean }>(
      `/workspaces/${encodeURIComponent(id)}/sources/fetch`,
      { url },
    );
  }
  export(id: string) {
    return this.call<{
      format: 'statework.snapshot';
      formatVersion: 1;
      exportedAt: string;
      state: WorkState;
    }>(`/workspaces/${encodeURIComponent(id)}/export`);
  }
  import(snapshot: unknown, target: { id: string; title: string }) {
    return this.call<WorkState>('/import', { snapshot, target });
  }
}
