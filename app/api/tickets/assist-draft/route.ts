import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateObject } from "ai";
import { getGoogleGenerativeAI, getGoogleGenerativeAiApiKey } from "@/lib/google-generative-ai";
import { getSessionContext } from "@/lib/session-context";
import { TICKET_TYPE_KIND_VALUES, type BuiltInTicketTypeKind } from "@/components/tickets/ticket-types";

/** One MC block: prompt + exactly four preset choices (UI adds a fifth "Other" + text). */
interface AssistDraftMcQuestion {
  prompt: string;
  options: [string, string, string, string];
}

function normalizeOptionString(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : String(raw).trim();
  return s.slice(0, 200);
}

function padOptionsToFour(options: string[]): [string, string, string, string] {
  const pool = [
    "Rarely — only once or a few times",
    "Often — most of the time when I try",
    "Only in one environment (e.g. prod vs staging)",
    "Unclear — I need the team to infer from context",
    "Affects only me / my account",
    "Could affect many users or customers",
  ];
  const o: string[] = [];
  const seen = new Set<string>();
  for (const x of options) {
    const n = normalizeOptionString(x);
    if (!n) continue;
    const k = n.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    o.push(n);
    if (o.length >= 4) break;
  }
  let p = 0;
  while (o.length < 4 && p < pool.length) {
    const c = pool[p]!;
    p += 1;
    if (!seen.has(c.toLowerCase())) {
      seen.add(c.toLowerCase());
      o.push(c);
    }
  }
  while (o.length < 4) {
    o.push(`Option ${o.length + 1}`);
  }
  return [o[0]!, o[1]!, o[2]!, o[3]!];
}

function normalizeMcQuestion(raw: unknown): AssistDraftMcQuestion | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as { prompt?: unknown; options?: unknown };
  const promptRaw = typeof obj.prompt === "string" ? obj.prompt.trim() : String(obj.prompt ?? "").trim();
  if (!promptRaw) return null;
  const prompt = promptRaw.slice(0, 500);
  const optsIn = Array.isArray(obj.options) ? obj.options : [];
  const opts = padOptionsToFour(optsIn.map((x) => normalizeOptionString(x)).filter(Boolean));
  return { prompt, options: opts };
}

function fallbackPromptsForType(ticketType: BuiltInTicketTypeKind): readonly string[] {
  switch (ticketType) {
    case "BUG":
    case "REGRESSION":
      return [
        "How reliably can you reproduce this?",
        "Where do you see it (page, screen, or URL)?",
        "What is the impact if we do not fix it soon?",
        "Any error message, code, or correlation ID to share?",
        "Who else have you seen affected (if anyone)?",
      ];
    case "FEATURE_REQUEST":
    case "MINOR_ENHANCEMENT":
      return [
        "Who is the primary beneficiary of this change?",
        "How urgent is this compared to your other work?",
        "What is the smallest version that would still help?",
        "Are there hard deadlines or dependencies?",
        "How will we know this is successful when shipped?",
      ];
    case "FEEDBACK":
      return [
        "How strongly does this affect your day-to-day?",
        "Is this mostly praise, concern, or a mix?",
        "Where in the product did this come up?",
        "Would a small tweak be enough, or is it broader?",
        "Anything we should avoid changing while addressing this?",
      ];
    case "SECURITY_IMPROVEMENT":
      return [
        "How severe do you believe the risk is?",
        "Is there known exploitation or only a concern so far?",
        "What scope should a fix cover?",
        "Any compliance or audit angle we should know?",
        "What would verify a fix to your satisfaction?",
      ];
  }
}

function ensureFiveMcQuestions(
  raw: readonly unknown[],
  ticketType: BuiltInTicketTypeKind
): AssistDraftMcQuestion[] {
  const fallbacks = fallbackPromptsForType(ticketType);
  const out: AssistDraftMcQuestion[] = [];
  for (const item of raw) {
    const q = normalizeMcQuestion(item);
    if (q) out.push(q);
    if (out.length >= 5) break;
  }
  let i = 0;
  while (out.length < 5 && i < fallbacks.length) {
    out.push({
      prompt: fallbacks[i]!,
      options: padOptionsToFour([]),
    });
    i += 1;
  }
  while (out.length < 5) {
    out.push({
      prompt: "What else should the team know to triage this ticket?",
      options: padOptionsToFour([]),
    });
  }
  return out.slice(0, 5).map((q) => ({
    prompt: q.prompt,
    options: padOptionsToFour([...q.options]),
  }));
}

const bodySchema = z.object({
  ticketType: z.enum(TICKET_TYPE_KIND_VALUES),
  situation: z.string().min(1).max(3000).trim(),
  extraContext: z.string().max(3000).optional(),
  phase: z.enum(["follow_up", "draft"]).default("draft"),
  followUpAnswers: z.string().max(8000).optional(),
});

const mcItemSchema = z.object({
  prompt: z.coerce.string(),
  options: z.array(z.coerce.string()).min(1).max(6),
});

const followUpMcBundleSchema = z.object({
  questions: z
    .array(mcItemSchema)
    .min(1)
    .max(8)
    .describe(
      "Exactly five intended: multiple-choice blocks for triage. Each prompt is one clear question; options are exactly four short, mutually distinct answer labels (no letters like A/B prefix). Tailor every option to the user's situation; include angles they may not have considered."
    ),
});

const ticketDraftSchema = z.object({
  title: z
    .string()
    .min(1)
    .max(120)
    .describe("Concise ticket title: specific and scannable, typically under 80 characters, no trailing period"),
  description: z
    .string()
    .min(1)
    .max(4000)
    .describe("Ticket body: clear context, steps, expected vs actual for bugs, or goals for features/feedback"),
});

export async function POST(req: NextRequest) {
  if (!getGoogleGenerativeAiApiKey()) {
    return NextResponse.json({ error: "AI assist is not configured" }, { status: 503 });
  }

  const ctx = await getSessionContext();
  if (!ctx?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { ticketType, situation, extraContext, phase, followUpAnswers } = parsed.data;

  const typeInstruction =
    ticketType === "BUG"
      ? "The ticket is a BUG: title should signal the defect; description covers what broke, expected vs actual, and reproduction hints."
      : ticketType === "FEATURE_REQUEST"
        ? "The ticket is a FEATURE REQUEST: title captures the capability; description covers user need, desired outcome, and constraints."
        : ticketType === "FEEDBACK"
          ? "The ticket is FEEDBACK: title summarizes the theme; description covers sentiment, context, and actionable takeaways."
          : ticketType === "MINOR_ENHANCEMENT"
            ? "The ticket is a MINOR ENHANCEMENT: title captures the small improvement; description covers scope, UX benefit, and acceptance criteria."
            : ticketType === "REGRESSION"
              ? "The ticket is a REGRESSION: title names what regressed; description covers what used to work, what fails now, and when it started."
              : "The ticket is a SECURITY IMPROVEMENT: title states the security goal; description covers risk, scope, and verification needs.";

  const extraBlock =
    extraContext?.trim() && extraContext.trim().length > 0
      ? `\n\nAdditional context:\n${extraContext.trim()}`
      : "";

  const answersBlock =
    followUpAnswers?.trim() && followUpAnswers.trim().length > 0
      ? `\n\nUser answers to follow-up questions:\n${followUpAnswers.trim()}`
      : "";

  if (phase === "follow_up") {
    const followUpPrompt = `You help RAD Dashboard users write better internal tickets.

${typeInstruction}

User notes (situation):
${situation}
${extraBlock}

Produce exactly FIVE multiple-choice questions in the "questions" array (no more, no fewer).
For EACH item:
- "prompt": one clear sentence ending with a question mark when appropriate.
- "options": an array of EXACTLY FOUR distinct, short answer labels (plain text, no "A)" prefixes). They must be plausible for THIS user's notes — include insightful angles they might not have thought of. Avoid duplicate or near-duplicate options.

Do NOT include an "Other" or free-text option in "options" — the product UI adds that separately.

Order questions from most critical for triage to helpful extras.`;

    try {
      const { object } = await generateObject({
        model: getGoogleGenerativeAI()("gemini-2.5-flash"),
        schema: followUpMcBundleSchema,
        schemaName: "FollowUpMcQuestions",
        schemaDescription: "Five multiple-choice follow-ups for ticket drafting",
        prompt: followUpPrompt,
        maxOutputTokens: 2048,
      });

      const questions = ensureFiveMcQuestions(object.questions, ticketType);
      return NextResponse.json({ questions });
    } catch (err: unknown) {
      console.error("[assist-draft] follow_up phase failed:", err);
      return NextResponse.json({ error: "Generation failed" }, { status: 502 });
    }
  }

  const prompt = `You help RAD Dashboard users draft internal tickets.

${typeInstruction}

User notes (situation):
${situation}
${extraBlock}
${answersBlock}

Produce a title and a description. Title must stand alone in ticket lists. Description may use short paragraphs or bullet lists. No greeting or sign-off. Plain text only; no markdown code fences except for numbered steps if essential.
If follow-up answers were provided, weave that detail naturally into the description.`;

  try {
    const { object } = await generateObject({
      model: getGoogleGenerativeAI()("gemini-2.5-flash"),
      schema: ticketDraftSchema,
      schemaName: "TicketDraft",
      schemaDescription: "Suggested ticket title and description for RAD Dashboard",
      prompt,
      maxOutputTokens: 2048,
    });

    const title = object.title.trim().slice(0, 120);
    const description = object.description.trim().slice(0, 4000);
    if (!title || !description) {
      return NextResponse.json({ error: "Could not generate draft" }, { status: 502 });
    }

    return NextResponse.json({ title, description });
  } catch {
    return NextResponse.json({ error: "Generation failed" }, { status: 502 });
  }
}
