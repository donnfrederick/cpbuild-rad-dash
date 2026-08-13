"use client";

import React, { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/navigation";
import { Plus } from "lucide-react";
import { CreateTicketDialog } from "@/components/tickets/CreateTicketDialog";
import { useAppUser } from "@/contexts/AppUserContext";
import { hasTicketTriageAccess } from "@/lib/ticket-triage";
import { useSprintRouteCreateTicketContext } from "@/hooks/useSprintRouteCreateTicketContext";

interface FeedbackButtonProps {
  variant?: "floating" | "inline";
  theme?: "light" | "dark";
  secondary?: boolean;
}

async function noopFetchTickets(): Promise<void> {}

export function FeedbackButton({
  variant = "floating",
  theme = "dark",
  secondary = false,
}: FeedbackButtonProps) {
  const t = useTranslations("tickets");
  const pathname = usePathname();
  const router = useRouter();
  const user = useAppUser();
  const canTriage = hasTicketTriageAccess(user.role, user.specialPermissions);
  const [open, setOpen] = useState(false);
  const { linkSprintId, allowedProjectIds } = useSprintRouteCreateTicketContext(canTriage);

  const onCreated = useCallback(
    (id: string) => {
      router.replace(`${pathname}?open=${encodeURIComponent(id)}`);
    },
    [router, pathname],
  );

  return (
    <>
      {variant === "floating" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("headerTicketButtonAria")}
          title={t("headerTicketButtonAria")}
          data-tour="header-create-ticket-button"
          className={[
            "fixed right-4 bottom-20 z-40 flex items-center gap-1.5",
            "rounded-full bg-primary-500 px-3 py-2 text-xs font-medium text-white shadow-lg",
            "transition-all hover:bg-primary-700 hover:shadow-xl active:scale-95",
            "focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:outline-none",
            "md:bottom-6 md:right-6",
          ].join(" ")}
        >
          <Plus size={16} aria-hidden />
          <span className="hidden sm:inline">{t("headerTicketButton")}</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("headerTicketButtonAria")}
          title={t("headerTicketButtonAria")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: !secondary ? 6 : 0,
            height: 34,
            padding: !secondary ? "0 12px 0 10px" : "0 8px",
            borderRadius: "var(--radius-sm)",
            border: "none",
            backgroundColor: secondary
              ? "transparent"
              : theme === "light"
                ? "var(--primary-500)"
                : "rgba(255,255,255,0.15)",
            color: secondary
              ? theme === "light"
                ? "var(--neutral-350)"
                : "rgba(255,255,255,0.27)"
              : "#fff",
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "0.01em",
            cursor: "pointer",
            transition: "background-color 0.15s, box-shadow 0.15s",
            boxShadow: !secondary && theme === "light" ? "0 1px 3px rgba(0,0,0,0.18)" : "none",
            flexShrink: 0,
            whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => {
            if (!secondary) {
              e.currentTarget.style.backgroundColor =
                theme === "light" ? "var(--primary-600)" : "rgba(255,255,255,0.25)";
              if (theme === "light") e.currentTarget.style.boxShadow = "0 2px 6px rgba(0,0,0,0.22)";
            } else {
              e.currentTarget.style.color =
                theme === "light" ? "var(--neutral-500)" : "rgba(255,255,255,0.50)";
              e.currentTarget.style.backgroundColor = "rgba(255,255,255,0.10)";
            }
          }}
          onMouseLeave={(e) => {
            if (!secondary) {
              e.currentTarget.style.backgroundColor =
                theme === "light" ? "var(--primary-500)" : "rgba(255,255,255,0.15)";
              if (theme === "light") e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.18)";
            } else {
              e.currentTarget.style.color =
                theme === "light" ? "var(--neutral-350)" : "rgba(255,255,255,0.27)";
              e.currentTarget.style.backgroundColor = "transparent";
            }
          }}
        >
          <Plus size={15} aria-hidden />
          {!secondary && <span style={{ lineHeight: 1 }}>{t("headerTicketButton")}</span>}
        </button>
      )}

      <CreateTicketDialog
        open={open}
        onOpenChange={setOpen}
        sprintId={linkSprintId}
        allowedProjectIds={allowedProjectIds}
        canTriage={canTriage}
        fetchTickets={noopFetchTickets}
        onCreated={onCreated}
      />
    </>
  );
}
