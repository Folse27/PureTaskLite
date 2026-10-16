import { parseBody, route } from "@/lib/server/http";
import { moveTask } from "@/lib/server/tasks";
import { moveTaskInput } from "@/lib/validation";

/** POST { id, parentId, date, index } — move a task (with its sub-notes) anywhere: another parent, day or position. */
export const POST = route(async (request) => {
  const { id, ...to } = await parseBody(request, moveTaskInput);
  return Response.json({ task: await moveTask(id, to) });
});
