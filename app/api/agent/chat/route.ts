import { NextRequest, NextResponse } from "next/server";
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from "ai";
import { getGoogleGenerativeAI, getGoogleGenerativeAiApiKey } from "@/lib/google-generative-ai";
import { getSessionContext } from "@/lib/session-context";
import { hasTicketTriageAccess } from "@/lib/ticket-access";
import { buildAgentSystemPrompt } from "@/lib/agent-system-prompt";
import { agentTools } from "@/lib/agent-tools";

export async function POST(req: NextRequest) {
  if (!getGoogleGenerativeAiApiKey()) {
    return NextResponse.json(
      { error: "AI agent is not configured" },
      { status: 503 },
    );
  }

  const ctx = await getSessionContext();
  if (!ctx?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasTicketTriageAccess(ctx.user.role, ctx.user.specialPermissions)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { messages } = body as { messages?: UIMessage[] };

  if (!Array.isArray(messages)) {
    return NextResponse.json({ error: "messages must be an array" }, { status: 400 });
  }

  const modelMessages = await convertToModelMessages(messages, {
    tools: agentTools,
  });

  const result = streamText({
    model: getGoogleGenerativeAI()("gemini-2.5-flash"),
    system: buildAgentSystemPrompt(ctx.user),
    messages: modelMessages,
    tools: agentTools,
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse();
}
