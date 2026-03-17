import * as Effect from "effect/Effect";
import { Atom, AtomRegistry, Suspense } from "fibrae";
import { NavigatorTag } from "fibrae/router";
import { DfgApi, type Message } from "./api.js";
import { currentUser, isAdmin } from "./auth.js";
import { Button } from "../ui/button.js";
import { EmptyState } from "../ui/empty_state.js";

/* ---------------------------------------------------------------------------
 * Atoms for local UI state
 * --------------------------------------------------------------------------- */

const selectedPartner = Atom.make<string | null>(null);
const composeText = Atom.make("");

/* ---------------------------------------------------------------------------
 * Helpers
 * --------------------------------------------------------------------------- */

/** Group messages by conversation partner (the other user's ID). */
function groupByPartner(
  messages: readonly Message[],
  myId: string,
): Map<string, Message[]> {
  const groups = new Map<string, Message[]>();
  for (const msg of messages) {
    const partnerId = msg.sender_id === myId ? msg.recipient_id : msg.sender_id;
    let thread = groups.get(partnerId);
    if (!thread) {
      thread = [];
      groups.set(partnerId, thread);
    }
    thread.push(msg);
  }
  // Sort each thread oldest-first for display
  for (const thread of groups.values()) {
    thread.sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  }
  return groups;
}

/** Count unread messages from a specific partner. */
function unreadCount(thread: readonly Message[], myId: string): number {
  return thread.filter((m) => m.recipient_id === myId && !m.is_read).length;
}

/** Format a timestamp for display. */
function formatTime(iso: string): string {
  const d = new Date(iso);
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

/* ---------------------------------------------------------------------------
 * MessageThread — renders selected conversation
 * --------------------------------------------------------------------------- */

function MessageThread(props: {
  thread: Message[];
  myId: string;
  partnerName: string;
  partnerId: string;
}) {
  return Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const api = yield* DfgApi;
    const text = registry.get(composeText);

    // Mark unread messages as read (best-effort, ignore errors)
    const unread = props.thread.filter(
      (m) => m.recipient_id === props.myId && !m.is_read,
    );
    if (unread.length > 0) {
      yield* Effect.forEach(
        unread,
        (m) => Effect.orDie(api.authenticated.markMessageRead({ path: { id: m.id }, payload: { is_read: true } })),
        { concurrency: "unbounded" },
      );
    }

    const onInput = (e: Event) => {
      const target = e.target as HTMLTextAreaElement;
      registry.set(composeText, target.value);
    };

    const onSend = () =>
      Effect.gen(function* () {
        const api = yield* DfgApi;
        const reg = yield* AtomRegistry.AtomRegistry;
        const body = reg.get(composeText).trim();
        if (!body) return;
        yield* api.authenticated.sendMessage({ payload: { recipient_id: props.partnerId, body } });
        reg.set(composeText, "");
        const navigator = yield* NavigatorTag;
        yield* navigator.go("/messages");
      });

    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        return onSend();
      }
    };

    return (
      <div class="flex flex-col h-full">
        {/* Header */}
        <div class="px-5 py-3 border-b border-white/[0.06] shrink-0">
          <h2 class="text-lg font-semibold text-primary">
            {props.partnerName}
          </h2>
        </div>

        {/* Messages */}
        <div class="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
          {props.thread.map((msg) => {
            const isMine = msg.sender_id === props.myId;
            return (
              <div
                class={`flex ${isMine ? "justify-end" : "justify-start"}`}
              >
                <div
                  class={[
                    "max-w-[75%] rounded-xl px-4 py-2.5 text-sm leading-relaxed",
                    isMine
                      ? "bg-accent/20 text-primary"
                      : "bg-white/[0.06] text-primary",
                  ].join(" ")}
                >
                  <p class="whitespace-pre-wrap break-words">{msg.body}</p>
                  <p
                    class={`text-xs mt-1 ${isMine ? "text-accent/50" : "text-muted/40"}`}
                  >
                    {formatTime(msg.created_at)}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Compose */}
        <div class="px-5 py-3 border-t border-white/[0.06] shrink-0">
          <div class="flex gap-3 items-end">
            <textarea
              data-cy="compose-input"
              value={text}
              oninput={onInput}
              onkeydown={onKeydown}
              placeholder="Type a message..."
              rows={2}
              class="flex-1 rounded-lg border border-white/10 bg-card px-4 py-3 text-primary placeholder:text-muted/50 outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/50 resize-none text-sm"
            />
            <Button
              data-cy="send-btn"
              onclick={onSend}
              disabled={!text.trim()}
              class="shrink-0"
            >
              Send
            </Button>
          </div>
        </div>
      </div>
    );
  });
}

/* ---------------------------------------------------------------------------
 * MessagesContent — main Effect component
 * --------------------------------------------------------------------------- */

function MessagesContent() {
  return Effect.gen(function* () {
    const registry = yield* AtomRegistry.AtomRegistry;
    const api = yield* DfgApi;
    const user = registry.get(currentUser);
    if (!user) return <div />;

    const admin = isAdmin(user);
    const allMessages = yield* api.authenticated.messages({ urlParams: {} });

    // Build name map: partnerId -> display name
    const nameMap = new Map<string, string>();
    if (admin) {
      const students = yield* api.admin.students({});
      for (const s of students) {
        nameMap.set(s.id, s.name);
      }
    }

    const getName = (partnerId: string): string => {
      if (admin) return nameMap.get(partnerId) ?? "Unknown Student";
      return "Teacher";
    };

    const conversations = groupByPartner(allMessages, user.id);
    const partnerIds = Array.from(conversations.keys());

    // For students with no messages yet, pre-select nothing (they'll use "New Message" area)
    // For admin with no messages, show empty state
    const selected = registry.get(selectedPartner);

    // Auto-select first conversation if none selected
    const activePartner =
      selected && conversations.has(selected)
        ? selected
        : partnerIds.length > 0
          ? partnerIds[0]!
          : null;

    const selectPartner = (id: string) => () => {
      registry.set(selectedPartner, id);
      registry.set(composeText, "");
    };

    // For students: if no conversations yet, allow composing to admin
    // We need at least one admin ID. Check messages or just show compose.
    // Actually simpler: if student has no conversations, show a "start conversation" prompt.

    if (conversations.size === 0) {
      if (admin) {
        return (
          <div>
            <h1 class="text-3xl font-bold tracking-tight mb-8">Messages</h1>
            <EmptyState message="No messages yet. Messages with students will appear here." />
          </div>
        );
      }

      // Student with no messages: show compose area to admin
      // We don't know the admin ID, so show a generic prompt
      return (
        <div>
          <h1 class="text-3xl font-bold tracking-tight mb-8">Messages</h1>
          <EmptyState message="No messages yet. Your conversations with your teacher will appear here." />
        </div>
      );
    }

    const activeThread = activePartner
      ? conversations.get(activePartner) ?? []
      : [];

    return (
      <div>
        <h1 class="text-3xl font-bold tracking-tight mb-6">Messages</h1>

        <div class="flex gap-4 h-[calc(100vh-12rem)]">
          {/* Conversation list sidebar */}
          <div class="w-72 shrink-0 flex flex-col rounded-xl border border-white/[0.06] bg-card overflow-hidden">
            <div class="px-4 py-3 border-b border-white/[0.06] text-sm font-semibold text-muted">
              Conversations
            </div>
            <div class="flex-1 overflow-y-auto">
              {partnerIds.map((pid) => {
                const thread = conversations.get(pid)!;
                const lastMsg = thread[thread.length - 1]!;
                const unread = unreadCount(thread, user.id);
                const isActive = pid === activePartner;

                return (
                  <button
                    type="button"
                    onclick={selectPartner(pid)}
                    data-cy={`conv-${pid}`}
                    class={[
                      "w-full text-left px-4 py-3 border-b border-white/[0.04] transition-colors cursor-pointer",
                      isActive
                        ? "bg-white/[0.08]"
                        : "hover:bg-white/[0.04]",
                    ].join(" ")}
                  >
                    <div class="flex items-center justify-between mb-1">
                      <span class="font-semibold text-sm text-primary truncate">
                        {getName(pid)}
                      </span>
                      <span class="text-xs text-muted/40 shrink-0 ml-2">
                        {formatTime(lastMsg.created_at)}
                      </span>
                    </div>
                    <div class="flex items-center justify-between">
                      <p class="text-xs text-muted truncate max-w-[180px]">
                        {lastMsg.body}
                      </p>
                      {unread > 0 ? (
                        <span class="rounded-full bg-accent/20 px-2 py-0.5 text-xs font-semibold text-accent shrink-0 ml-2">
                          {unread}
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Thread panel */}
          <div class="flex-1 rounded-xl border border-white/[0.06] bg-card overflow-hidden">
            {activePartner ? (
              <Suspense
                fallback={
                  <p class="text-muted p-5">Loading messages...</p>
                }
                threshold={0}
              >
                <MessageThread
                  thread={activeThread}
                  myId={user.id}
                  partnerName={getName(activePartner)}
                  partnerId={activePartner}
                />
              </Suspense>
            ) : (
              <div class="flex items-center justify-center h-full text-muted">
                Select a conversation
              </div>
            )}
          </div>
        </div>
      </div>
    );
  });
}

/* ---------------------------------------------------------------------------
 * MessagesPage — public export
 * --------------------------------------------------------------------------- */

export const MessagesPage = () => (
  <main
    data-cy="messages"
    class="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16"
  >
    <Suspense
      fallback={<p class="text-muted">Loading messages...</p>}
      threshold={50}
    >
      <MessagesContent />
    </Suspense>
  </main>
);
