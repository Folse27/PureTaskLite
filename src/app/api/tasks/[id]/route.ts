import { parseBody, route } from "@/lib/server/http";
import { deleteTask, updateTask } from "@/lib/server/tasks";
import { id as idSchema, updateTaskInput } from "@/lib/validation";

type Ctx = RouteContext<"/api/tasks/[id]">;

export const PATCH = route(async (request, ctx: Ctx) => {
  const id = idSchema.parse((await ctx.params).id);
  const patch = await parseBody(request, updateTaskInput);
  return Response.json(await updateTask(id, patch));
});

export const DELETE = route(async (_request, ctx: Ctx) => {
  const id = idSchema.parse((await ctx.params).id);
  return Response.json(await deleteTask(id));
});
