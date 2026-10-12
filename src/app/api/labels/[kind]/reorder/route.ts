import { parseBody, route } from "@/lib/server/http";
import { reorderLabels } from "@/lib/server/labels";
import { labelKind, reorderLabelsInput } from "@/lib/validation";

export const POST = route(async (request, ctx: RouteContext<"/api/labels/[kind]/reorder">) => {
  const kind = labelKind.parse((await ctx.params).kind);
  const { orderedIds } = await parseBody(request, reorderLabelsInput);
  await reorderLabels(kind, orderedIds);
  return Response.json({ ok: true });
});
