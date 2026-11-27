import type { SlaState, TicketPriority, TicketStatus } from "./types.ts";

export const SLA_HOURS_BY_PRIORITY: Record<TicketPriority, number> = {
  critical: 2,
  high: 8,
  medium: 24,
  low: 48,
};

export function computeSlaDueAt(priority: TicketPriority, fromDate = new Date()): string {
  const hours = SLA_HOURS_BY_PRIORITY[priority];
  return new Date(fromDate.getTime() + hours * 60 * 60 * 1000).toISOString();
}

export function evaluateSla(
  params: {
    priority: TicketPriority;
    status: TicketStatus;
    createdAt: string;
    slaDueAt: string;
    resolvedAt: string | null;
  },
  now = new Date()
): { slaState: SlaState; slaRemainingMinutes: number } {
  const dueMs = new Date(params.slaDueAt).getTime();
  const createdMs = new Date(params.createdAt).getTime();
  const totalWindowMs = Math.max(dueMs - createdMs, 1);

  if (params.status === "resolved" || params.status === "closed") {
    const endMs = params.resolvedAt ? new Date(params.resolvedAt).getTime() : now.getTime();
    const diffMinutes = Math.round((dueMs - endMs) / 60000);
    return {
      slaState: endMs <= dueMs ? "met" : "breached",
      slaRemainingMinutes: diffMinutes,
    };
  }

  const remainingMs = dueMs - now.getTime();
  const remainingMinutes = Math.round(remainingMs / 60000);

  if (remainingMs < 0) {
    return { slaState: "breached", slaRemainingMinutes: remainingMinutes };
  }

  if (remainingMs / totalWindowMs <= 0.25) {
    return { slaState: "at_risk", slaRemainingMinutes: remainingMinutes };
  }

  return { slaState: "on_track", slaRemainingMinutes: remainingMinutes };
}
