export interface TicketAgentPromptComment {
  body: string;
  createdAt: string;
  author: { name: string | null; email: string };
  attachments?: Array<{ storageUrl: string; caption: string | null; mimeType: string }>;
}

export interface TicketAgentPromptReport {
  id: string;
  shortId: number;
  ref: string;
  title: string;
  description: string;
  pageUrl: string | null;
  status: string;
  priority?: string | null;
  type: string;
  source?: string;
  createdAt: string;
  user: { name: string | null; email: string };
  assignee?: { name: string | null; email: string } | null;
  adminNote?: string | null;
  screenshot?: string | null;
  videoUrl?: string | null;
}

function displayName(u: { name: string | null; email: string }): string {
  return (u.name && u.name.trim()) || u.email;
}

function isoDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString();
}

export function buildTicketAgentPromptMarkdown(
  report: TicketAgentPromptReport,
  comments: TicketAgentPromptComment[],
  options: { appDeepLink: string }
): string {
  const ref = report.ref;
  const lines: string[] = [
    "## RAD Dashboard ticket (context for an AI assistant)",
    "",
    "Paste this whole block when asking a coding agent to work on this item.",
    "",
    `- **Human reference:** ${ref}`,
    `- **Record id (UUID):** \`${report.id}\``,
    `- **App / deep link:** ${options.appDeepLink}`,
    `- **Type:** ${report.type}`,
    `- **Source:** ${report.source ?? "IN_APP"}`,
    `- **Status:** ${report.status}`,
    `- **Priority:** ${report.priority ?? "_(not set)_"}`,
    `- **Title:** ${report.title}`,
    `- **Submitted by:** ${displayName(report.user)}`,
    `- **Submitted at (UTC):** ${isoDate(report.createdAt)}`,
  ];

  lines.push(`- **Assignee:** ${report.assignee ? displayName(report.assignee) : "Unassigned"}`);

  lines.push("", "### Description", "", report.description.trim() || "_(empty)_", "");

  if (report.pageUrl) {
    lines.push("### Page URL", "", report.pageUrl, "");
  }

  if (report.screenshot) {
    lines.push("### Screenshot", "", report.screenshot, "");
  }

  if (report.videoUrl) {
    lines.push("### Screen recording", "", report.videoUrl, "");
  }

  if (report.adminNote?.trim()) {
    lines.push("### Internal triage note", "", report.adminNote.trim(), "");
  }

  lines.push("### Comment thread (chronological)", "");

  if (comments.length === 0) {
    lines.push("_No comments yet._", "");
  } else {
    const sorted = [...comments].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    sorted.forEach((c, i) => {
      const when = isoDate(c.createdAt);
      lines.push(`#### Comment ${i + 1} — ${displayName(c.author)} @ ${when}`, "", c.body.trim() || "_(empty)_");
      const atts = c.attachments ?? [];
      if (atts.length > 0) {
        lines.push("", "Attachments:");
        atts.forEach((a) => {
          const kind = a.mimeType.startsWith("image/")
            ? "image"
            : a.mimeType.startsWith("video/")
              ? "video"
              : a.mimeType.startsWith("audio/")
                ? "audio"
                : "file";
          const cap = a.caption ? ` — ${a.caption}` : "";
          lines.push(`- (${kind}) ${a.storageUrl}${cap}`);
        });
      }
      lines.push("");
    });
  }

  return lines.join("\n");
}
