import { parseBody, parseQuery, route } from "@/lib/server/http";
import { deleteLabel, updateLabel } from "@/lib/server/labels";
import { deleteLabelQuery, id as idSchema, labelKind, updateLabelInput } from "@/lib/validation";

type Ctx = RouteContext<"/api/labels/[kind]/[id]">;

async function params(ctx: Ctx) {
  const p = await ctx.params;
  return { kind: labelKind.parse(p.kind), id: idSchema.parse(p.id) };
}

export const PATCH = route(async (request, ctx: Ctx) => {
  const { kind, id } = await params(ctx);
  const input = await parseBody(request, updateLabelInput);
  return Response.json({ label: await updateLabel(kind, id, input) });
});

/** DELETE …?reassignTo=<id>|none — responds 409 { inUse } if tasks use it and no choice was given. */
export const DELETE = route(async (request, ctx: Ctx) => {
  const { kind, id } = await params(ctx);
  const { reassignTo } = parseQuery(request, deleteLabelQuery);
  return Response.json(await deleteLabel(kind, id, reassignTo));
});
