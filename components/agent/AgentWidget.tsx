"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Bot, X, Plus, Clock, MessageSquare } from "lucide-react";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import { Chat } from "@ai-sdk/react";
import { AgentChat } from "./AgentChat";

// ─── Types ────────────────────────────────────────────────────────────────────
interface ConversationSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: UIMessage[];
}

const STORAGE_KEY = "rad-agent-conversations";
const MAX_SESSIONS = 50;

// ─── Persistence helpers ──────────────────────────────────────────────────────
function loadSessions(): ConversationSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ConversationSession[]) : [];
  } catch {
    return [];
  }
}

function saveSessions(sessions: ConversationSession[]): void {
  try {
    const pruned = sessions.slice(0, MAX_SESSIONS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
  } catch {
    // storage quota — silently ignore
  }
}

function createSession(): ConversationSession {
  return {
    id: crypto.randomUUID(),
    title: "",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [],
  };
}

function deriveTitle(messages: UIMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "";
  const part = first.parts.find((p) => p.type === "text");
  const text = part && "text" in part ? String(part.text) : "";
  return text.slice(0, 60);
}

// ─── Relative time ────────────────────────────────────────────────────────────
function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Floating AI agent widget — persists across all authenticated routes.
 * Renders a toggle button in the bottom-right corner; clicking it opens a
 * chat panel. The panel is kept mounted so conversation history is preserved
 * while navigating.
 *
 * Each conversation is backed by a single `Chat` instance owned by the widget,
 * so streaming responses continue even when the user switches conversations.
 */
export function AgentWidget() {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"chat" | "history">("chat");
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const [activeChat, setActiveChat] = useState<Chat<UIMessage> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // One Chat instance per conversation id. Lives as long as the widget is
  // mounted, so in-flight streams survive switching between conversations.
  const chatsRef = useRef<Map<string, Chat<UIMessage>>>(new Map());
  const unsubsRef = useRef<Map<string, () => void>>(new Map());

  // Load sessions on mount. We intentionally sync from localStorage inside
  // an effect (rather than via lazy useState init) to avoid SSR/client
  // hydration mismatches — window is not available on the server.
  useEffect(() => {
    const stored = loadSessions();
    if (stored.length > 0) {
      setSessions(stored);
      setActiveId(stored[0].id);
    } else {
      const fresh = createSession();
      setSessions([fresh]);
      setActiveId(fresh.id);
    }
  }, []);

  // Tear down every Chat subscription on unmount
  useEffect(() => {
    const unsubs = unsubsRef.current;
    const chats = chatsRef.current;
    return () => {
      unsubs.forEach((unsub) => unsub());
      unsubs.clear();
      chats.clear();
    };
  }, []);

  // Close on Escape
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && open) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Trap focus within panel when open
  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  const persistChatMessages = useCallback(
    (id: string, messages: UIMessage[]): void => {
      setSessions((prev) => {
        const idx = prev.findIndex((s) => s.id === id);
        if (idx === -1) return prev;
        const existing = prev[idx];

        // Always write through to localStorage. Streaming updates mutate the
        // last assistant message in place (same id, same array length), so
        // comparing length + last id would incorrectly treat growing content
        // as "unchanged" and drop the assistant reply on refresh.
        const title = existing.title || deriveTitle(messages);
        const updated: ConversationSession = {
          ...existing,
          title,
          messages,
          updatedAt: Date.now(),
        };

        // Move updated session to front
        const next = [updated, ...prev.filter((s) => s.id !== id)];
        saveSessions(next);
        return next;
      });
    },
    [],
  );

  const getOrCreateChat = useCallback(
    (session: ConversationSession): Chat<UIMessage> => {
      const existing = chatsRef.current.get(session.id);
      if (existing) return existing;

      const chat = new Chat<UIMessage>({
        id: session.id,
        messages: session.messages,
        transport: new DefaultChatTransport({ api: "/api/agent/chat" }),
      });
      chatsRef.current.set(session.id, chat);

      // Persist whenever the chat's messages change — regardless of which
      // conversation is currently visible. This is what allows background
      // streams to be saved even when the user has navigated elsewhere.
      // Throttle persistence so we don't write to localStorage on every
      // streaming token — 500ms is fast enough to survive a refresh while
      // keeping disk churn low on long conversations.
      const unsub = chat["~registerMessagesCallback"](() => {
        persistChatMessages(session.id, chat.messages);
      }, 500);
      unsubsRef.current.set(session.id, unsub);

      return chat;
    },
    [persistChatMessages],
  );

  // Resolve the active Chat instance in an effect rather than during render,
  // since creation mutates refs (chatsRef/unsubsRef). Cached lookups return
  // the same instance, so this is a no-op for the common case.
  useEffect(() => {
    const session = sessions.find((s) => s.id === activeId);
    if (!session) {
      setActiveChat(null);
      return;
    }
    setActiveChat(getOrCreateChat(session));
  }, [activeId, sessions, getOrCreateChat]);

  function handleNewChat() {
    const fresh = createSession();
    setSessions((prev) => {
      const next = [fresh, ...prev];
      saveSessions(next);
      return next;
    });
    setActiveId(fresh.id);
    setView("chat");
  }

  function handleSelectSession(id: string) {
    setActiveId(id);
    setView("chat");
  }

  // Sessions with at least one message (for history display)
  const historyItems = sessions.filter((s) => s.messages.length > 0);

  return (
    <>
      {/* Chat panel */}
      <div
        ref={panelRef}
        tabIndex={-1}
        aria-label="RAD AI Assistant"
        role="dialog"
        aria-modal="true"
        className={[
          "fixed bottom-20 right-4 z-50 flex flex-col",
          "w-[360px] rounded-xl border border-border bg-background shadow-xl",
          "transition-all duration-200 ease-in-out outline-none",
          "sm:w-[400px]",
          open
            ? "opacity-100 translate-y-0 pointer-events-auto"
            : "opacity-0 translate-y-4 pointer-events-none",
        ].join(" ")}
        style={{ height: "520px" }}
      >
        {/* Panel header */}
        <div className="flex items-center justify-between border-b px-4 py-3 shrink-0">
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-primary/10 p-1">
              <Bot className="size-4 text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-none">RAD Assistant</p>
              <p className="text-xs text-muted-foreground mt-0.5">Powered by Gemini</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleNewChat}
              aria-label="New chat"
              title="New chat"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <Plus className="size-4" />
            </button>
            <button
              onClick={() => setView((v) => (v === "history" ? "chat" : "history"))}
              aria-label="Conversation history"
              title="Conversation history"
              className={[
                "rounded-md p-1.5 transition-colors",
                view === "history"
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              ].join(" ")}
            >
              <Clock className="size-4" />
            </button>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close AI assistant"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden">
          {view === "history" ? (
            <HistoryPanel
              items={historyItems}
              activeId={activeId}
              onSelect={handleSelectSession}
            />
          ) : (
            activeChat && <AgentChat key={activeChat.id} chat={activeChat} />
          )}
        </div>
      </div>

      {/* Toggle button */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        aria-label={open ? "Close AI assistant" : "Open AI assistant"}
        aria-expanded={open}
        className={[
          "fixed bottom-4 right-4 z-50",
          "flex size-12 items-center justify-center rounded-full",
          "bg-primary text-primary-foreground shadow-lg",
          "hover:bg-primary/90 transition-all duration-150",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2",
        ].join(" ")}
      >
        {open ? <X className="size-5" /> : <Bot className="size-5" />}
      </button>
    </>
  );
}

// ─── History panel ─────────────────────────────────────────────────────────────
function HistoryPanel({
  items,
  activeId,
  onSelect,
}: {
  items: ConversationSession[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center p-6">
        <div className="rounded-full bg-muted p-3">
          <MessageSquare className="size-5 text-muted-foreground" />
        </div>
        <div>
          <p className="text-sm font-medium">No history yet</p>
          <p className="text-xs text-muted-foreground mt-1">
            Start a conversation and it will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <p className="px-4 pt-3 pb-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Recent conversations
      </p>
      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-0.5">
        {items.map((session) => (
          <button
            key={session.id}
            onClick={() => onSelect(session.id)}
            className={[
              "w-full flex items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
              session.id === activeId
                ? "bg-accent text-accent-foreground"
                : "hover:bg-muted/60",
            ].join(" ")}
          >
            <MessageSquare className="size-4 shrink-0 mt-0.5 text-muted-foreground" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate leading-snug">
                {session.title || "Untitled conversation"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {relativeTime(session.updatedAt)}
              </p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
