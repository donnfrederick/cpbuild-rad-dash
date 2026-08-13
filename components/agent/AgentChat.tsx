"use client";

import { useState, useRef, useEffect } from "react";
import { useChat, type Chat } from "@ai-sdk/react";
import { type UIMessage } from "ai";
import {
  Bot,
  User,
  Send,
  Loader2,
  CheckCircle,
  XCircle,
  AlertCircle,
  Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

// ─── Write tool names that require client-side confirmation ──────────────────
const WRITE_TOOLS = new Set([
  "createTicket",
  "updateTicket",
  "addComment",
  "linkDuplicate",
]);

// ─── Label helpers ───────────────────────────────────────────────────────────
function getToolLabel(toolName: string): string {
  switch (toolName) {
    case "createTicket":
      return "Create ticket";
    case "updateTicket":
      return "Update ticket";
    case "addComment":
      return "Add comment";
    case "linkDuplicate":
      return "Link as duplicate";
    case "searchTickets":
      return "Searching tickets";
    case "getTicket":
      return "Looking up ticket";
    case "listProjects":
      return "Loading projects";
    case "getTicketAnalytics":
      return "Calculating analytics";
    case "getAppHelp":
      return "Loading help";
    case "findDuplicateCandidates":
      return "Finding possible duplicates";
    case "auditDuplicates":
      return "Auditing for duplicates";
    default:
      return toolName;
  }
}

interface ConfirmCardProps {
  toolName: string;
  toolCallId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: Record<string, any>;
  addToolOutput: (args: {
    tool: string;
    toolCallId: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    output: any;
  }) => void;
}

function ConfirmCard({ toolName, toolCallId, input, addToolOutput }: ConfirmCardProps) {
  const [loading, setLoading] = useState(false);

  async function executeWrite(): Promise<{ success: boolean; message: string }> {
    if (toolName === "createTicket") {
      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: input.type,
          title: input.title,
          description: input.description,
          priority: input.priority ?? null,
          storyPoints: input.storyPoints ?? null,
          projectId:
            typeof input.projectId === "string" && input.projectId.trim().length > 0
              ? input.projectId.trim()
              : null,
        }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        return { success: false, message: err.error ?? "Failed to create ticket" };
      }
      const ticket = (await res.json()) as { ref?: string; shortId?: number };
      const ref =
        ticket.ref ??
        (typeof ticket.shortId === "number"
          ? `RAD-${String(ticket.shortId).padStart(4, "0")}`
          : "ticket");
      return { success: true, message: `Ticket ${ref} created successfully.` };
    }

    if (toolName === "updateTicket") {
      const patch: Record<string, unknown> = {};
      if (input.status !== undefined) patch.status = input.status;
      if (input.priority !== undefined) patch.priority = input.priority;
      if (input.assigneeId !== undefined) patch.assigneeId = input.assigneeId;
      if (input.projectId !== undefined) patch.projectId = input.projectId;

      const res = await fetch(`/api/tickets/${input.ticketId as string}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        return { success: false, message: err.error ?? "Failed to update ticket" };
      }
      return { success: true, message: `${input.ticketRef as string} updated successfully.` };
    }

    if (toolName === "addComment") {
      const res = await fetch(`/api/tickets/${input.ticketId as string}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: input.body }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        return { success: false, message: err.error ?? "Failed to add comment" };
      }
      return {
        success: true,
        message: `Comment added to ${input.ticketRef as string}.`,
      };
    }

    if (toolName === "linkDuplicate") {
      const res = await fetch(
        `/api/tickets/${input.duplicateId as string}/link-duplicate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ canonicalId: input.canonicalId }),
        }
      );
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        return { success: false, message: err.error ?? "Failed to link duplicate" };
      }
      return {
        success: true,
        message: `${input.duplicateRef as string} linked as duplicate of ${input.canonicalRef as string}.`,
      };
    }

    return { success: false, message: "Unknown write tool." };
  }

  async function handleConfirm() {
    setLoading(true);
    try {
      const result = await executeWrite();
      addToolOutput({ tool: toolName, toolCallId, output: result });
      if (result.success) {
        toast.success(result.message);
      } else {
        toast.error(result.message);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error";
      addToolOutput({ tool: toolName, toolCallId, output: { success: false, message } });
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  function handleDeny() {
    addToolOutput({
      tool: toolName,
      toolCallId,
      output: { success: false, message: "User cancelled the action." },
    });
  }

  function renderSummary(): React.ReactNode {
    if (toolName === "createTicket") {
      return (
        <div className="space-y-1 text-sm">
          <div>
            <span className="font-medium">Type:</span> {String(input.type)}
          </div>
          <div>
            <span className="font-medium">Title:</span> {String(input.title)}
          </div>
          {input.priority && (
            <div>
              <span className="font-medium">Priority:</span> {String(input.priority)}
            </div>
          )}
          {input.storyPoints !== undefined && input.storyPoints !== null && (
            <div>
              <span className="font-medium">Story points:</span> {String(input.storyPoints)}
            </div>
          )}
          <div>
            <span className="font-medium">Project:</span>{" "}
            {input.projectName ? String(input.projectName) : "None"}
          </div>
          <div className="mt-1 line-clamp-3 text-muted-foreground">
            {String(input.description)}
          </div>
        </div>
      );
    }

    if (toolName === "updateTicket") {
      const changes: string[] = [];
      if (input.status) changes.push(`Status → ${String(input.status)}`);
      if (input.priority !== undefined)
        changes.push(`Priority → ${input.priority ? String(input.priority) : "none"}`);
      if (input.assigneeId !== undefined)
        changes.push(`Assignee → ${input.assigneeId ? "updated" : "unassigned"}`);
      if (input.projectId !== undefined)
        changes.push(`Project → ${input.projectId ? (input.projectName ? String(input.projectName) : "updated") : "removed"}`);
      return (
        <div className="space-y-1 text-sm">
          <div>
            <span className="font-medium">Ticket:</span> {String(input.ticketRef)}
          </div>
          {changes.map((c) => (
            <div key={c} className="text-muted-foreground">
              {c}
            </div>
          ))}
        </div>
      );
    }

    if (toolName === "addComment") {
      return (
        <div className="space-y-1 text-sm">
          <div>
            <span className="font-medium">Ticket:</span> {String(input.ticketRef)}
          </div>
          <div className="mt-1 line-clamp-3 text-muted-foreground">{String(input.body)}</div>
        </div>
      );
    }

    if (toolName === "linkDuplicate") {
      const percent =
        typeof input.similarity === "number"
          ? Math.round((input.similarity as number) * 100)
          : null;
      return (
        <div className="space-y-1 text-sm">
          <div>
            <span className="font-medium">Duplicate:</span>{" "}
            {String(input.duplicateRef)}
          </div>
          <div>
            <span className="font-medium">Canonical:</span>{" "}
            {String(input.canonicalRef)}
          </div>
          {percent !== null && (
            <div>
              <span className="font-medium">Similarity:</span> {percent}%
            </div>
          )}
          {input.reason && (
            <div className="mt-1 line-clamp-3 text-muted-foreground">
              {String(input.reason)}
            </div>
          )}
        </div>
      );
    }

    return null;
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/30">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-300">
        <AlertCircle className="size-4 shrink-0" />
        {getToolLabel(toolName)} — confirm?
      </div>
      <div className="mb-3">{renderSummary()}</div>
      <div className="flex gap-2">
        <Button size="sm" onClick={handleConfirm} disabled={loading}>
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <CheckCircle className="size-3.5" />
          )}
          Confirm
        </Button>
        <Button size="sm" variant="outline" onClick={handleDeny} disabled={loading}>
          <XCircle className="size-3.5" />
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Badge helpers ───────────────────────────────────────────────────────────

const STATUS_BADGE_STYLES: Record<string, string> = {
  BACKLOG: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  READY: "bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300",
  IN_PROGRESS: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  FOR_REVIEW: "bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300",
  RESOLVED: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300",
  TO_BE_DEPLOYED: "bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300",
  DONE: "bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300",
  ARCHIVED: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

const PRIORITY_BADGE_STYLES: Record<string, string> = {
  HIGH: "bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300",
  MEDIUM: "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300",
  LOW: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  NONE: "bg-muted text-muted-foreground",
};

const TYPE_BADGE_STYLES: Record<string, string> = {
  BUG: "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300",
  FEATURE_REQUEST: "bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300",
  FEEDBACK: "bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300",
  MINOR_ENHANCEMENT: "bg-amber-100 text-amber-900 dark:bg-amber-950/60 dark:text-amber-200",
  REGRESSION: "bg-orange-100 text-orange-900 dark:bg-orange-950/60 dark:text-orange-200",
  SECURITY_IMPROVEMENT: "bg-violet-100 text-violet-900 dark:bg-violet-950/60 dark:text-violet-200",
};

function prettify(value: string): string {
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function Badge({ value, styles }: { value: string; styles: Record<string, string> }) {
  const key = value.trim().toUpperCase().replace(/ /g, "_");
  const cls = styles[key] ?? "bg-muted text-muted-foreground";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}
    >
      {prettify(value)}
    </span>
  );
}

function TicketRef({ ref: refText }: { ref: string }) {
  return (
    <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-semibold text-primary">
      {refText}
    </span>
  );
}

// ─── Markdown renderer ───────────────────────────────────────────────────────

function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");

  return (
    <div className="space-y-1">
      {lines.map((line, i) => renderLine(line, i))}
    </div>
  );
}

function renderLine(line: string, key: number): React.ReactNode {
  // Headings
  if (line.startsWith("## ")) {
    return (
      <p key={key} className="font-semibold text-sm mt-2">
        {renderInline(line.slice(3))}
      </p>
    );
  }
  if (line.startsWith("### ")) {
    return (
      <p key={key} className="font-medium text-sm mt-1.5">
        {renderInline(line.slice(4))}
      </p>
    );
  }

  // Bullet item (supports leading whitespace → nested level)
  const bulletMatch = line.match(/^(\s*)([-*])\s+(.+)$/);
  if (bulletMatch) {
    const indent = bulletMatch[1]?.length ?? 0;
    const content = bulletMatch[3];
    const level = Math.min(Math.floor(indent / 2), 2);
    const marker = level === 0 ? "•" : level === 1 ? "◦" : "▪";
    const indentClass = level === 1 ? "ml-4" : level === 2 ? "ml-8" : "";

    return (
      <div
        key={key}
        className={`flex gap-1.5 text-sm leading-relaxed ${indentClass}`}
      >
        <span className="mt-[2px] shrink-0 text-muted-foreground">{marker}</span>
        <span className="flex-1">{renderLabelledLine(content)}</span>
      </div>
    );
  }

  if (line.trim() === "") {
    return <div key={key} className="h-1" />;
  }

  return (
    <p key={key} className="text-sm leading-relaxed">
      {renderLabelledLine(line)}
    </p>
  );
}

// Detect "**Label:** value" and apply badge styling for Status / Priority / Type
function renderLabelledLine(text: string): React.ReactNode {
  const labelMatch = text.match(/^\*\*([^*]+?):\*\*\s*(.+)$/);
  if (!labelMatch) return renderInline(text);

  const label = labelMatch[1].trim();
  const value = labelMatch[2].trim();
  const labelKey = label.toLowerCase();

  if (labelKey === "status") {
    return (
      <>
        <span className="font-medium text-foreground">{label}:</span>{" "}
        <Badge value={value} styles={STATUS_BADGE_STYLES} />
      </>
    );
  }
  if (labelKey === "priority") {
    return (
      <>
        <span className="font-medium text-foreground">{label}:</span>{" "}
        <Badge value={value} styles={PRIORITY_BADGE_STYLES} />
      </>
    );
  }
  if (labelKey === "type") {
    return (
      <>
        <span className="font-medium text-foreground">{label}:</span>{" "}
        <Badge value={value} styles={TYPE_BADGE_STYLES} />
      </>
    );
  }

  return (
    <>
      <span className="font-medium text-foreground">{label}:</span>{" "}
      <span className="text-muted-foreground">{renderInline(value)}</span>
    </>
  );
}

/** Project-scoped, UN-*, or legacy RAD-* ticket keys (3+ digit suffix). */
const DISPLAY_TICKET_REF_INNER = /^[A-Z0-9]{2,10}-\d{3,}$/i;

function renderInline(text: string): React.ReactNode {
  // First split by bold / inline code, then within plain segments detect PREFIX-#### refs.
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      const inner = part.slice(2, -2);
      if (DISPLAY_TICKET_REF_INNER.test(inner)) {
        return <TicketRef key={i} ref={inner} />;
      }
      return <strong key={i}>{inner}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
          {part.slice(1, -1)}
        </code>
      );
    }
    return renderPlainWithRefs(part, i);
  });
}

function renderPlainWithRefs(text: string, keyBase: number): React.ReactNode {
  const segments = text.split(/([A-Z0-9]{2,10}-\d{3,})/gi);
  if (segments.length === 1) return text;
  return segments.map((seg, i) => {
    if (DISPLAY_TICKET_REF_INNER.test(seg)) {
      return <TicketRef key={`${keyBase}-${i}`} ref={seg} />;
    }
    return <span key={`${keyBase}-${i}`}>{seg}</span>;
  });
}

// ─── Main chat component ─────────────────────────────────────────────────────
interface AgentChatProps {
  chat: Chat<UIMessage>;
}

export function AgentChat({ chat }: AgentChatProps) {
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, addToolOutput, error } = useChat({
    chat,
  });

  // Surface stream errors to the user. The Chat instance is shared across
  // mounts, so we only toast once per new error occurrence.
  const lastErrorRef = useRef<Error | undefined>(undefined);
  useEffect(() => {
    if (error && error !== lastErrorRef.current) {
      lastErrorRef.current = error;
      toast.error("Agent encountered an error. Please try again.");
    }
    if (!error) {
      lastErrorRef.current = undefined;
    }
  }, [error]);

  const isLoading = status === "submitted" || status === "streaming";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || isLoading) return;
    setInput("");
    void sendMessage({ text: trimmed });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center py-8">
            <div className="rounded-full bg-primary/10 p-3">
              <Bot className="size-6 text-primary" />
            </div>
            <div>
              <p className="text-sm font-medium">RAD Assistant</p>
              <p className="text-xs text-muted-foreground mt-1">
                Ask me about tickets, projects, or how to use the app.
              </p>
            </div>
            <div className="flex flex-col gap-1.5 w-full max-w-xs">
              {[
                "Show me all open bugs",
                "How many tickets are in progress?",
                "How do I assign a ticket?",
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setInput(suggestion);
                  }}
                  className="rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs text-left hover:bg-muted transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message: UIMessage) => (
          <MessageRow
            key={message.id}
            message={message}
            addToolOutput={addToolOutput}
          />
        ))}

        {isLoading && messages[messages.length - 1]?.role === "user" && (
          <div className="flex items-start gap-2">
            <div className="size-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
              <Bot className="size-3.5 text-primary" />
            </div>
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground pt-1">
              <Loader2 className="size-3.5 animate-spin" />
              Thinking…
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/20 p-2 text-xs text-destructive">
            Something went wrong. Please try again.
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t p-3">
        <form onSubmit={handleSubmit} className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about tickets, projects…"
            rows={1}
            disabled={isLoading}
            className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-50 max-h-28 overflow-y-auto"
            style={{ height: "auto" }}
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = "auto";
              el.style.height = `${el.scrollHeight}px`;
            }}
          />
          <Button
            type="submit"
            size="icon"
            disabled={!input.trim() || isLoading}
            className="shrink-0"
          >
            {isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </Button>
        </form>
        <p className="mt-1.5 text-center text-xs text-muted-foreground">
          Powered by Gemini · RAD Dashboard only
        </p>
      </div>
    </div>
  );
}

// ─── Single message row ───────────────────────────────────────────────────────
function MessageRow({
  message,
  addToolOutput,
}: {
  message: UIMessage;
  addToolOutput: (args: {
    tool: string;
    toolCallId: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    output: any;
  }) => void;
}) {
  const isUser = message.role === "user";

  if (isUser) {
    const textPart = message.parts.find((p) => p.type === "text");
    const text = textPart && "text" in textPart ? String(textPart.text) : "";
    return (
      <div className="flex items-start gap-2 justify-end">
        <div className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground max-w-[85%]">
          {text}
        </div>
        <div className="size-6 rounded-full bg-secondary flex items-center justify-center shrink-0 mt-0.5">
          <User className="size-3.5 text-secondary-foreground" />
        </div>
      </div>
    );
  }

  // Assistant message — render each part
  const hasContent = message.parts.some(
    (p) => p.type === "text" || p.type.startsWith("tool-")
  );
  if (!hasContent) return null;

  return (
    <div className="flex items-start gap-2">
      <div className="size-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
        <Bot className="size-3.5 text-primary" />
      </div>
      <div className="flex-1 space-y-2 max-w-[90%]">
        {message.parts.map((part, i) => {
          if (part.type === "text" && "text" in part) {
            const text = String(part.text).trim();
            if (!text) return null;
            return (
              <div key={i} className="rounded-lg bg-muted px-3 py-2">
                <SimpleMarkdown text={text} />
              </div>
            );
          }

          if (part.type.startsWith("tool-")) {
            const toolName = part.type.slice("tool-".length);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const invocation = part as any;
            const state: string = invocation.state as string;
            const toolCallId: string = invocation.toolCallId as string;

            // Write tool pending confirmation
            if (WRITE_TOOLS.has(toolName) && state === "input-available") {
              return (
                <ConfirmCard
                  key={toolCallId}
                  toolName={toolName}
                  toolCallId={toolCallId}
                  input={invocation.input as Record<string, unknown>}
                  addToolOutput={addToolOutput}
                />
              );
            }

            // Read tool running
            if (state === "input-streaming" || (state === "input-available" && !WRITE_TOOLS.has(toolName))) {
              return (
                <div
                  key={toolCallId}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground"
                >
                  <Loader2 className="size-3 animate-spin" />
                  {getToolLabel(toolName)}…
                </div>
              );
            }

            // Read tool completed (output-available) — show subtle indicator
            if (state === "output-available") {
              if (WRITE_TOOLS.has(toolName)) return null; // handled by text response
              return (
                <div
                  key={toolCallId}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground/60"
                >
                  <Database className="size-3" />
                  {getToolLabel(toolName)} — done
                </div>
              );
            }

            return null;
          }

          return null;
        })}
      </div>
    </div>
  );
}
