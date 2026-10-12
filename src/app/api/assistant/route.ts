import { assistantInput } from "@/lib/ai/conversation";
import { runAssistant } from "@/lib/ai/assistant";
import { GroqError } from "@/lib/ai/groq";
import { parseBody, route } from "@/lib/server/http";

export const maxDuration = 60;

/** POST { text, history } → { reply, changes, history } */
export const POST = route(async (request) => {
  const { text, history } = await parseBody(request, assistantInput);
  try {
    return Response.json(await runAssistant(text, history));
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
