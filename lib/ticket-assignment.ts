/** Role codes allowed as ticket assignees (matches `roles.code` in DB). */
export const TICKET_ASSIGNEE_ROLE_CODES = ["ADMIN", "MEMBER"] as const;

export type TicketAssignableRoleCode = (typeof TICKET_ASSIGNEE_ROLE_CODES)[number];

const ASSIGNEE_SET = new Set<string>(TICKET_ASSIGNEE_ROLE_CODES);

export function isAllowedTicketAssigneeRole(roleCode: string): boolean {
  const normalized = roleCode === "SUPER_ADMIN" ? "ADMIN" : roleCode;
  return ASSIGNEE_SET.has(normalized);
}

export function filterMembersForTicketAssignee<T extends { role: string }>(members: T[]): T[] {
  return members.filter((m) => isAllowedTicketAssigneeRole(m.role));
}
