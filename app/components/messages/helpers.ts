import type { Message } from "../../../shared/schemas.js";

/** Group messages by conversation partner (the other user's ID). */
export function groupByPartner(messages: readonly Message[], myId: string): Map<string, Message[]> {
  const groups = new Map<string, Message[]>();
  messages.forEach((msg) => {
    const partnerId = msg.sender_id === myId ? msg.recipient_id : msg.sender_id;
    const thread = groups.get(partnerId);
    if (thread) {
      thread.push(msg);
    } else {
      groups.set(partnerId, [msg]);
    }
  });
  // Sort each thread oldest-first for display
  groups.forEach((thread) => {
    thread.sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
  });
  return groups;
}

/** Count unread messages from a specific partner. */
export function unreadCount(thread: readonly Message[], myId: string): number {
  return thread.filter((m) => m.recipient_id === myId && !m.is_read).length;
}

/** Format a timestamp for display. */
export function formatTime(d: Date): string {
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
