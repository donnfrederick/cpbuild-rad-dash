import { describe, expect, it } from "vitest";
import { TICKETS_INBOX_REFRESH_EVENT } from "@/lib/ticket-inbox-events";

describe("TICKETS_INBOX_REFRESH_EVENT", () => {
  it("is a non-empty string", () => {
    expect(typeof TICKETS_INBOX_REFRESH_EVENT).toBe("string");
    expect(TICKETS_INBOX_REFRESH_EVENT.length).toBeGreaterThan(0);
  });
});
