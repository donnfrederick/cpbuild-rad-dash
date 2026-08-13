/**
 * Client-only React rendering for @mention syntax and auto-linked URLs.
 */

import type { ReactNode } from "react";
import { MENTION_REGEX } from "@/lib/mention-utils";

export function renderMentionNodes(text: string): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  const re = new RegExp(MENTION_REGEX.source, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const name = match[1] ?? "";
    parts.push(
      <span
        key={match.index}
        className="rounded px-0.5 text-sm font-semibold text-primary"
        style={{ backgroundColor: "var(--primary-50, hsl(var(--primary) / 0.15))" }}
      >
        @{name}
      </span>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : <>{parts}</>;
}

/**
 * Renders plain text with @mentions (same chips as {@link renderMentionNodes}) and
 * bare `http://` / `https://` URLs as links that open in a new tab.
 */
export function renderRichText(text: string): ReactNode {
  if (!text) return text;
  const parts: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  /** Fresh regex each call so `exec` does not reuse a polluted `lastIndex`. */
  const re = new RegExp(`${MENTION_REGEX.source}|(https?:\\/\\/[^\\s<>"']+)`, "gi");
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    const url = match[3];
    if (url) {
      parts.push(
        <a
          key={`rt-${match.index}-${key++}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all font-medium text-primary underline"
        >
          {url}
        </a>
      );
    } else {
      const name = match[1] ?? "";
      parts.push(
        <span
          key={`rt-${match.index}-${key++}`}
          className="rounded px-0.5 text-sm font-semibold text-primary"
          style={{ backgroundColor: "var(--primary-50, hsl(var(--primary) / 0.15))" }}
        >
          @{name}
        </span>
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    parts.push(text.slice(last));
  }
  return parts.length === 1 && typeof parts[0] === "string" ? parts[0] : <>{parts}</>;
}
