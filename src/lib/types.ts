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

/** A turn in the assistant conversation, kept by the client for follow-ups. */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Deletions the assistant is holding until the user confirms ("yes"). */
export interface PendingDelete {
  ids: string[];
  titles: string[];
  /** Tasks that will be removed, including sub-notes. */
  total: number;
}
