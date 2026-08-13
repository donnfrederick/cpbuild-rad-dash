"use client";

import { useEffect, useState, useRef } from "react";
import { useTranslations } from "next-intl";
import { Bell, X, Loader2 } from "lucide-react";
import { NotificationCard, type NotificationItem } from "./NotificationCard";

async function loadNotifications(): Promise<NotificationItem[]> {
  const res = await fetch("/api/notifications");
  if (!res.ok) return [];
  return res.json() as Promise<NotificationItem[]>;
}

export function NotificationBell() {
  const t = useTranslations("notifications");
  const tCommon = useTranslations("common");

  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLElement | null>(null);

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Load existing notifications once on mount, then keep in sync via SSE
  useEffect(() => {
    let cancelled = false;
    // Timestamp of the last successful error-triggered refetch.
    // Prevents request spikes when EventSource fires repeated error events
    // during transient outages / rapid reconnect attempts.
    const MIN_ERROR_REFETCH_MS = 30_000;
    let lastErrorRefetchAt = 0;

    async function initialLoad() {
      try {
        const data = await loadNotifications();
        if (!cancelled) setNotifications(data);
      } catch {
        /* ignore */
      }
    }
    void initialLoad();

    const es = new EventSource("/api/notifications/stream");

    // Reset the backoff clock each time the connection fully re-opens so that
    // the next error event after a clean reconnect is allowed to refetch.
    es.addEventListener("open", () => {
      lastErrorRefetchAt = 0;
    });

    es.addEventListener("message", (e: MessageEvent<string>) => {
      try {
        const incoming = JSON.parse(e.data) as NotificationItem;
        setNotifications((prev) => {
          // Avoid duplicates if the same notification arrives twice
          if (prev.some((n) => n.id === incoming.id)) return prev;
          return [incoming, ...prev];
        });
      } catch {
        /* ignore malformed events */
      }
    });

    es.addEventListener("error", () => {
      // EventSource will automatically attempt to reconnect.
      // When it does, re-fetch the full list to catch any missed notifications.
      // Guard: skip if the connection is permanently closed or we refetched recently.
      if (es.readyState === EventSource.CLOSED) return;
      const now = Date.now();
      if (now - lastErrorRefetchAt < MIN_ERROR_REFETCH_MS) return;
      lastErrorRefetchAt = now;
      loadNotifications()
        .then((data) => {
          if (!cancelled) setNotifications(data);
        })
        .catch(() => {
          /* network unavailable — will retry after next open/error cycle */
        });
    });

    return () => {
      cancelled = true;
      es.close();
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function refresh() {
      setLoading(true);
      try {
        const data = await loadNotifications();
        if (!cancelled) setNotifications(data);
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void refresh();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  async function markRead(id: string) {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try {
      await fetch(`/api/notifications/${id}`, { method: "PATCH" });
    } catch {
      /* optimistic */
    }
  }

  async function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    try {
      await fetch("/api/notifications/mark-all-read", { method: "POST" });
    } catch {
      /* ignore */
    }
  }

  return (
    <>
      <div style={{ position: "relative", display: "inline-flex" }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={t("title")}
          aria-expanded={open}
          aria-haspopup="dialog"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "var(--input-height)",
            height: "var(--input-height)",
            borderRadius: "var(--radius-sm)",
            backgroundColor: open ? "var(--neutral-100)" : "transparent",
            border: "none",
            cursor: "pointer",
            position: "relative",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--neutral-100)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = open ? "var(--neutral-100)" : "transparent";
          }}
        >
          <Bell
            style={{
              width: "var(--icon-size)",
              height: "var(--icon-size)",
              color: "var(--neutral-700)",
            }}
          />
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                top: 4,
                right: 4,
                minWidth: 16,
                height: 16,
                borderRadius: 8,
                backgroundColor: "var(--error-600)",
                color: "#fff",
                fontSize: 9,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: "0 3px",
                border: "2px solid var(--neutral-0)",
                lineHeight: 1,
              }}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </div>

      {open && (
        <>
          <div
            aria-hidden="true"
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(0,0,0,0.3)",
              zIndex: 40,
              animation: "fadeIn 0.15s ease-out",
            }}
          />

          <aside
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("title")}
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              width: "min(380px, 100vw)",
              backgroundColor: "var(--neutral-0)",
              boxShadow: "-4px 0 24px rgba(0,0,0,0.15)",
              zIndex: 50,
              display: "flex",
              flexDirection: "column",
              animation: "slideInRight 0.2s ease-out",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "var(--space-4)",
                borderBottom: "1px solid var(--neutral-200)",
                flexShrink: 0,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h3
                  style={{
                    margin: 0,
                    fontSize: "var(--text-subheading)",
                    fontWeight: 600,
                    color: "var(--neutral-900)",
                  }}
                >
                  {t("title")}
                </h3>
                {unreadCount > 0 && (
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--primary-600)",
                      backgroundColor: "var(--primary-100)",
                      borderRadius: 8,
                      padding: "1px 6px",
                    }}
                  >
                    {unreadCount} {t("unread")}
                  </span>
                )}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={markAllRead}
                    style={{
                      fontSize: 12,
                      color: "var(--primary-600)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      padding: "4px 6px",
                      borderRadius: "var(--radius-sm)",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = "var(--primary-50)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "transparent";
                    }}
                  >
                    {t("markAllRead")}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={tCommon("close")}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 32,
                    height: 32,
                    borderRadius: "var(--radius-sm)",
                    border: "none",
                    backgroundColor: "transparent",
                    cursor: "pointer",
                    color: "var(--neutral-600)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = "var(--neutral-100)";
                    e.currentTarget.style.color = "var(--neutral-900)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = "transparent";
                    e.currentTarget.style.color = "var(--neutral-600)";
                  }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: "auto" }}>
              {loading ? (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    padding: "var(--space-8)",
                  }}
                >
                  <Loader2
                    size={20}
                    style={{
                      color: "var(--neutral-400)",
                      animation: "spin 1s linear infinite",
                    }}
                  />
                </div>
              ) : notifications.length === 0 ? (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    padding: "var(--space-8)",
                    color: "var(--neutral-500)",
                    fontSize: "var(--text-body)",
                    textAlign: "center",
                  }}
                >
                  <Bell size={32} style={{ color: "var(--neutral-300)", marginBottom: 4 }} />
                  <p style={{ margin: 0 }}>{t("empty")}</p>
                </div>
              ) : (
                notifications.map((n) => (
                  <NotificationCard
                    key={n.id}
                    notification={n}
                    onMarkRead={markRead}
                    onClose={() => setOpen(false)}
                  />
                ))
              )}
            </div>
          </aside>
        </>
      )}
    </>
  );
}
