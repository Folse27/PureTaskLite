import { parseBody, route } from "@/lib/server/http";
import { createLabel, listLabels } from "@/lib/server/labels";
import { createLabelInput, labelKind } from "@/lib/validation";

type Ctx = RouteContext<"/api/labels/[kind]">;

/** GET /api/labels/statuses | /api/labels/priorities */
export const GET = route(async (_request, ctx: Ctx) => {
  const kind = labelKind.parse((await ctx.params).kind);
  return Response.json({ labels: await listLabels(kind) });
});

export const POST = route(async (request, ctx: Ctx) => {
  const kind = labelKind.parse((await ctx.params).kind);
  const input = await parseBody(request, createLabelInput);
  return Response.json({ label: await createLabel(kind, input) }, { status: 201 });
});
