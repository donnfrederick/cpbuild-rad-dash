/**
 * @mention syntax: @[Display Name](userId)
 */

export const MENTION_REGEX = /@\[([^\]]+)\]\(([^)]+)\)/g;

export function extractMentionIds(text: string): string[] {
  const ids = new Set<string>();
  const regex = new RegExp(MENTION_REGEX.source, "g");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const userId = match[2];
    if (userId) ids.add(userId);
  }
  return Array.from(ids);
}

export function stripMentionSyntax(text: string): string {
  return text.replace(new RegExp(MENTION_REGEX.source, "g"), "@$1");
}

export function renderMentionsAsHtml(text: string): string {
  return text.replace(
    new RegExp(MENTION_REGEX.source, "g"),
    (_match, name: string) =>
      `<span class="mention">@${name.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</span>`
  );
}
