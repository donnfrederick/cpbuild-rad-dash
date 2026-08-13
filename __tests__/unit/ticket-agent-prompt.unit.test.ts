import { describe, it, expect } from "vitest";
import { buildTicketAgentPromptMarkdown } from "@/lib/ticket-agent-prompt";

describe("buildTicketAgentPromptMarkdown", () => {
  it("includes human ref, UUID, and deep link", () => {
    const md = buildTicketAgentPromptMarkdown(
      {
        id: "tid-1",
        shortId: 7,
        ref: "RAD-0007",
        title: "Example",
        description: "Desc",
        pageUrl: null,
        status: "BACKLOG",
        priority: null,
        type: "BUG",
        source: "IN_APP",
        createdAt: "2026-01-01T00:00:00.000Z",
        user: { name: null, email: "u@x.com" },
        assignee: null,
        adminNote: null,
        screenshot: null,
        videoUrl: null,
      },
      [],
      { appDeepLink: "https://app.example/en/tickets/tid-1/details" }
    );
    expect(md).toContain("RAD-0007");
    expect(md).toContain("`tid-1`");
    expect(md).toContain("https://app.example/en/tickets/tid-1/details");
    expect(md).toContain("RAD Dashboard ticket");
  });
});
