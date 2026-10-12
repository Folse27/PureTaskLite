/**
 * Sub-note nesting: a top-level task has depth 0 and may have sub-notes down to
 * depth 3 (task → sub → sub-sub → sub-sub-sub).
 */
export const MAX_DEPTH = 3;

export class DepthLimitError extends Error {
  constructor(message = `Sub-notes can only be nested ${MAX_DEPTH} levels deep.`) {
    super(message);
    this.name = "DepthLimitError";
  }
}

/** Whether a task at this depth may receive sub-notes (controls the "add sub-note" UI). */
export function canAddChild(depth: number): boolean {
  return depth < MAX_DEPTH;
}

/** Depth of a new task created under a parent at `parentDepth` (or top-level when null). */
export function childDepth(parentDepth: number | null | undefined): number {
  const depth = parentDepth == null ? 0 : parentDepth + 1;
  if (depth > MAX_DEPTH) throw new DepthLimitError();
  return depth;
}

/**
 * Whether a subtree whose deepest node is `subtreeHeight` levels below its
 * root can be placed with its root at `newRootDepth`.
 */
export function subtreeFits(newRootDepth: number, subtreeHeight: number): boolean {
  return newRootDepth >= 0 && newRootDepth + subtreeHeight <= MAX_DEPTH;
}
