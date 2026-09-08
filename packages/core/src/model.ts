export const SCHEMA_VERSION = 1 as const;
export type ItemKind = 'task' | 'project' | 'note' | 'event';
export type Status = 'inbox' | 'ready' | 'active' | 'done' | 'cancelled';
export type Role = 'owner' | 'editor' | 'reader';
export interface Principal {
  id: string;
  role: Role;
}
export interface Schedule {
  start: string;
  end: string;
  timeZone: string;
}
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
export interface WorkItem {
  id: string;
  kind: ItemKind;
  title: string;
  description: string;
  status: Status;
  priority: 0 | 1 | 2 | 3;
  tags: string[];
  effortMinutes: number | null;
  dueDate: string | null;
  schedule: Schedule | null;
  extensions: Record<string, JsonValue>;
  archived: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export type ItemInput = Pick<WorkItem, 'id' | 'title' | 'kind'> &
  Partial<
    Pick<
      WorkItem,
      | 'description'
      | 'status'
      | 'priority'
      | 'tags'
      | 'effortMinutes'
      | 'dueDate'
      | 'schedule'
      | 'extensions'
    >
  >;
export type ItemPatch = Partial<
  Omit<WorkItem, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'archived'>
>;
/** depends_on: from requires to; contains: from is the parent of to. */
export interface Relation {
  id: string;
  kind: 'depends_on' | 'contains' | 'relates_to';
  from: string;
  to: string;
}
export interface Query {
  text?: string;
  statuses?: Status[];
  kinds?: ItemKind[];
  tags?: string[];
  parentId?: string;
  actionable?: boolean;
  scheduled?: boolean;
  archived?: boolean;
  dueBefore?: string;
  sort?: 'priority' | 'due' | 'updated' | 'title';
}
export interface SavedView {
  id: string;
  title: string;
  query: Query;
  renderer: string;
}
export interface WorkState {
  schemaVersion: 1;
  workspace: { id: string; title: string; revision: number; createdAt: string };
  items: WorkItem[];
  relations: Relation[];
  views: SavedView[];
}
export type Command =
  | { type: 'item.create'; item: ItemInput }
  | { type: 'item.update'; id: string; expectedVersion: number; patch: ItemPatch }
  | { type: 'item.archive'; id: string; expectedVersion: number; archived: boolean }
  | { type: 'relation.add'; relation: Relation }
  | { type: 'relation.remove'; id: string }
  | { type: 'view.save'; view: SavedView }
  | { type: 'view.remove'; id: string }
  | { type: 'workspace.rename'; title: string };
export interface CommandRequest {
  schemaVersion: 1;
  requestId: string;
  expectedRevision: number;
  commands: Command[];
}
export interface DomainEvent {
  sequence: number;
  workspaceId: string;
  actorId: string;
  at: string;
  requestId: string;
  commands: Command[];
}
export interface CommandResult {
  revision: number;
  event: DomainEvent;
}
export type ErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'FORBIDDEN'
  | 'CYCLE'
  | 'BLOCKED'
  | 'LIMIT'
  | 'UNAUTHORIZED';
export class WorkError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'WorkError';
  }
}
export const isFinished = (item: WorkItem): boolean =>
  item.status === 'done' || item.status === 'cancelled';
export function emptyState(id: string, title: string, at: string): WorkState {
  return {
    schemaVersion: 1,
    workspace: { id, title, revision: 0, createdAt: at },
    items: [],
    relations: [],
    views: [],
  };
}
