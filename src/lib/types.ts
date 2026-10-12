/** Shapes shared between server and client (JSON-serialised). */

export type LabelKind = "statuses" | "priorities";

export interface Label {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
}

export interface Task {
  id: string;
  date: string;
  parentId: string | null;
  depth: number;
  title: string;
  description: string | null;
  statusId: string | null;
  priorityId: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskPatch {
  title?: string;
  description?: string | null;
  statusId?: string | null;
  priorityId?: string | null;
  date?: string;
}

/** A change made by the voice assistant, shown in the assistant sheet. */
export interface AssistantChange {
  kind: "created" | "updated" | "moved" | "deleted";
  taskId: string;
  title: string;
  date: string;
  /** Number of tasks removed, including sub-notes (deletions only). */
  count?: number;
}

/** OpenAI-compatible chat message as kept in the client-side session history. */
export type ChatMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };
