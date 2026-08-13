/** Storage keys from POST /api/upload/... with type=tickets (align with upload route). */
export const TICKET_STORAGE_PREFIX = "field-media/tickets/";

export function isValidTicketAttachmentKey(key: string): boolean {
  return (
    key.startsWith(TICKET_STORAGE_PREFIX) &&
    !key.includes("..") &&
    !key.includes("\0")
  );
}

export function assertTicketAttachmentKeys(keys: string[]): string | null {
  for (const k of keys) {
    if (!isValidTicketAttachmentKey(k)) {
      return "Invalid attachment storage key";
    }
  }
  return null;
}
