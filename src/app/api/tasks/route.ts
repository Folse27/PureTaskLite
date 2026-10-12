import { parseBody, parseQuery, route } from "@/lib/server/http";
import { createTask, listTasks } from "@/lib/server/tasks";
import { createTaskInput, dateRangeQuery } from "@/lib/validation";

/** GET /api/tasks?from=YYYY-MM-DD&to=YYYY-MM-DD — all tasks and sub-notes in range. */
export const GET = route(async (request) => {
  const { from, to } = parseQuery(request, dateRangeQuery);
  return Response.json({ tasks: await listTasks(from, to) });
});

export const POST = route(async (request) => {
  const input = await parseBody(request, createTaskInput);
  return Response.json({ task: await createTask(input) }, { status: 201 });
});
