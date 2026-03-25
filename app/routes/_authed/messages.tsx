import { useState, useEffect, useRef } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import type { Message, User } from "../../lib/types.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { Button } from "../../components/ui/Button.js";
import { EmptyState } from "../../components/ui/EmptyState.js";

const messagesQuery = queryOptions({
  queryKey: ["messages"],
  queryFn: async () => {
    const { data, error } = await api.messages.get();
    if (error) throw error;
    return data;
  },
});

export const Route = createFileRoute("/_authed/messages")({
  loader: ({ context }) => context.queryClient.ensureQueryData(messagesQuery),
  head: () => ({ meta: [{ title: "Messages | DFG Portal" }] }),
  component: MessagesPage,
  pendingComponent: () => (
    <main className="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16 text-muted">Loading...</main>
  ),
});

/* ---------------------------------------------------------------------------
 * Helpers
 * --------------------------------------------------------------------------- */

/** Group messages by conversation partner (the other user's ID). */
function groupByPartner(
  messages: readonly Message[],
  myId: string,
): Map<string, Message[]> {
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
    thread.sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    );
  });
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
 * MessagesPage
 * --------------------------------------------------------------------------- */

function MessagesPage() {
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const { data: allMessages } = useSuspenseQuery(messagesQuery);

  // Admin: fetch students for name lookup
  const { data: studentsData } = useSuspenseQuery({
    queryKey: ["admin", "students"],
    queryFn: async () => {
      if (!isAdmin) return [] as User[];
      const { data, error } = await api.admin.students.get();
      if (error) throw error;
      return data;
    },
  });

  const nameMap = new Map<string, string>();
  if (isAdmin) {
    (studentsData as User[]).forEach((s) => {
      nameMap.set(s.id, s.name);
    });
  }

  const getName = (partnerId: string): string => {
    if (isAdmin) return nameMap.get(partnerId) ?? "Unknown Student";
    return "Teacher";
  };

  if (!user) return null;

  const conversations = groupByPartner(allMessages, user.id);
  const partnerIds = Array.from(conversations.keys());

  const [selectedPartner, setSelectedPartner] = useState<string | null>(null);
  const [composeText, setComposeText] = useState("");

  // Auto-select first conversation if none selected
  const activePartner =
    selectedPartner && conversations.has(selectedPartner)
      ? selectedPartner
      : partnerIds.length > 0
        ? partnerIds[0]!
        : null;

  const selectPartner = (id: string) => () => {
    setSelectedPartner(id);
    setComposeText("");
  };

  // ---- Mutations ----
  const sendMessageMutation = useMutation({
    mutationFn: async (payload: { recipient_id?: string; body: string }) => {
      const { data, error } = await api.messages.post(payload);
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.messages[id].patch({ is_read: true });
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
    },
  });

  // ---- No conversations: empty or compose ----
  if (conversations.size === 0) {
    if (isAdmin) {
      return (
        <main
          data-pwid="messages"
          className="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16"
        >
          <h1 className="text-3xl font-bold tracking-tight mb-8">Messages</h1>
          <EmptyState message="No messages yet. Messages with students will appear here." />
        </main>
      );
    }

    // Student with no messages: show compose form
    const onSend = () => {
      const body = composeText.trim();
      if (!body) return;
      sendMessageMutation.mutate({ body }, {
        onSuccess: () => setComposeText(""),
      });
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onSend();
      }
    };

    return (
      <main
        data-pwid="messages"
        className="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16"
      >
        <h1 className="text-3xl font-bold tracking-tight mb-8">Messages</h1>
        <div className="rounded-xl border border-white/[0.06] bg-card p-5">
          <p className="text-muted text-sm mb-4">Send a message to your teacher.</p>
          <div className="flex flex-col gap-3">
            <textarea
              data-pwid="compose-input"
              value={composeText}
              onChange={(e) => setComposeText(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Type a message..."
              rows={3}
              className="rounded-lg border border-white/10 bg-card px-4 py-3 text-primary placeholder:text-muted/50 outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/50 resize-none text-sm"
            />
            <div className="flex justify-end">
              <Button data-pwid="send-btn" onClick={onSend} disabled={!composeText.trim()}>
                Send
              </Button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const activeThread = activePartner
    ? conversations.get(activePartner) ?? []
    : [];

  return (
    <main
      data-pwid="messages"
      className="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16"
    >
      <h1 className="text-3xl font-bold tracking-tight mb-6">Messages</h1>

      <div className="flex gap-4 h-[calc(100vh-12rem)]">
        {/* Conversation list sidebar */}
        <div className="w-72 shrink-0 flex flex-col rounded-xl border border-white/[0.06] bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-white/[0.06] text-sm font-semibold text-muted">
            Conversations
          </div>
          <div className="flex-1 overflow-y-auto">
            {partnerIds.map((pid) => {
              const thread = conversations.get(pid)!;
              const lastMsg = thread[thread.length - 1]!;
              const unread = unreadCount(thread, user.id);
              const isActive = pid === activePartner;

              return (
                <button
                  key={pid}
                  type="button"
                  onClick={selectPartner(pid)}
                  data-pwid={`conv-${pid}`}
                  className={[
                    "w-full text-left px-4 py-3 border-b border-white/[0.04] transition-colors cursor-pointer",
                    isActive
                      ? "bg-white/[0.08]"
                      : "hover:bg-white/[0.04]",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-sm text-primary truncate">
                      {getName(pid)}
                    </span>
                    <span className="text-xs text-muted/40 shrink-0 ml-2">
                      {formatTime(lastMsg.created_at)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted truncate max-w-[180px]">
                      {lastMsg.body}
                    </p>
                    {unread > 0 ? (
                      <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs font-semibold text-accent shrink-0 ml-2">
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
        <div className="flex-1 rounded-xl border border-white/[0.06] bg-card overflow-hidden">
          {activePartner ? (
            <MessageThread
              thread={activeThread}
              myId={user.id}
              partnerName={getName(activePartner)}
              partnerId={activePartner}
              composeText={composeText}
              setComposeText={setComposeText}
              sendMessageMutation={sendMessageMutation}
              markReadMutation={markReadMutation}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted">
              Select a conversation
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

/* ---------------------------------------------------------------------------
 * MessageThread — renders selected conversation
 * --------------------------------------------------------------------------- */

function MessageThread({
  thread,
  myId,
  partnerName,
  partnerId,
  composeText,
  setComposeText,
  sendMessageMutation,
  markReadMutation,
}: {
  thread: Message[];
  myId: string;
  partnerName: string;
  partnerId: string;
  composeText: string;
  setComposeText: (text: string) => void;
  sendMessageMutation: ReturnType<typeof useMutation<Message, Error, { recipient_id?: string; body: string }>>;
  markReadMutation: ReturnType<typeof useMutation<{ success: true }, Error, string>>;
}) {
  const markedRef = useRef(new Set<string>());

  // Mark unread messages as read
  useEffect(() => {
    const unread = thread.filter(
      (m) => m.recipient_id === myId && !m.is_read && !markedRef.current.has(m.id),
    );
    unread.forEach((m) => {
      markedRef.current.add(m.id);
      markReadMutation.mutate(m.id);
    });
  }, [thread, myId, markReadMutation]);

  const onSend = () => {
    const body = composeText.trim();
    if (!body) return;
    sendMessageMutation.mutate(
      { recipient_id: partnerId, body },
      { onSuccess: () => setComposeText("") },
    );
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-5 py-3 border-b border-white/[0.06] shrink-0">
        <h2 className="text-lg font-semibold text-primary">
          {partnerName}
        </h2>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
        {thread.map((msg) => {
          const isMine = msg.sender_id === myId;
          return (
            <div
              key={msg.id}
              className={`flex ${isMine ? "justify-end" : "justify-start"}`}
            >
              <div
                className={[
                  "max-w-[75%] rounded-xl px-4 py-2.5 text-sm leading-relaxed",
                  isMine
                    ? "bg-accent/20 text-primary"
                    : "bg-white/[0.06] text-primary",
                ].join(" ")}
              >
                <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                <p
                  className={`text-xs mt-1 ${isMine ? "text-accent/50" : "text-muted/40"}`}
                >
                  {formatTime(msg.created_at)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Compose */}
      <div className="px-5 py-3 border-t border-white/[0.06] shrink-0">
        <div className="flex gap-3 items-end">
          <textarea
            data-pwid="compose-input"
            value={composeText}
            onChange={(e) => setComposeText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a message..."
            rows={2}
            className="flex-1 rounded-lg border border-white/10 bg-card px-4 py-3 text-primary placeholder:text-muted/50 outline-none transition-colors focus:border-accent focus:ring-1 focus:ring-accent/50 resize-none text-sm"
          />
          <Button
            data-pwid="send-btn"
            onClick={onSend}
            disabled={!composeText.trim()}
            className="shrink-0"
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
