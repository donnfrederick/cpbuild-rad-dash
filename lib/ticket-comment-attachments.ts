/** Storage keys from POST /api/upload/... with type=ticket-comments (align with your upload route). */
export const TICKET_COMMENT_STORAGE_PREFIX = "field-media/ticket-comments/";

export function isValidTicketCommentAttachmentKey(key: string): boolean {
  return (
    key.startsWith(TICKET_COMMENT_STORAGE_PREFIX) &&
    !key.includes("..") &&
    !key.includes("\0")
  );
}

export function assertTicketCommentAttachmentKeys(keys: string[]): string | null {
  for (const k of keys) {
    if (!isValidTicketCommentAttachmentKey(k)) {
      return "Invalid attachment storage key";
    }
  }
  return null;
}
