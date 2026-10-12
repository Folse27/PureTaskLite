import { parseBody, route } from "@/lib/server/http";
import { reorderTasks } from "@/lib/server/tasks";
import { reorderTasksInput } from "@/lib/validation";

export const POST = route(async (request) => {
  const { date, parentId, orderedIds } = await parseBody(request, reorderTasksInput);
  await reorderTasks(date, parentId, orderedIds);
  return Response.json({ ok: true });
});
