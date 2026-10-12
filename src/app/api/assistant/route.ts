import { assistantInput } from "@/lib/ai/conversation";
import { runAssistant } from "@/lib/ai/assistant";
import { GroqError } from "@/lib/ai/groq";
import { parseBody, route } from "@/lib/server/http";

export const maxDuration = 60;

/** POST { text, history, pendingDelete? } → { reply, changes, history, pendingDelete } */
export const POST = route(async (request) => {
  const input = await parseBody(request, assistantInput);
  try {
    return Response.json(await runAssistant(input));
  } catch (error) {
    if (error instanceof GroqError) {
      return Response.json(
        { error: error.userMessage, retryAfterSeconds: error.retryAfterSeconds },
        { status: error.status },
      );
    }
    throw error;
  }
});
