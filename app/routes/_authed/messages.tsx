import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { messagesQuery, adminStudentsQuery, unwrap } from "../../lib/queries.js";
import type { Message, User } from "../../lib/types.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { Button } from "../../components/ui/Button.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { groupByPartner } from "../../components/messages/helpers.js";
import { MessageThread } from "../../components/messages/MessageThread.js";
import { ConversationList } from "../../components/messages/ConversationList.js";

export const Route = createFileRoute("/_authed/messages")({
  loader: async ({ context: { queryClient, isAdmin } }) => {
    if (isAdmin) {
      await Promise.allSettled([
        queryClient.ensureQueryData(messagesQuery),
        queryClient.ensureQueryData(adminStudentsQuery),
      ]);
    } else {
      await queryClient.ensureQueryData(messagesQuery);
    }
  },
  head: () => ({ meta: [{ title: "Messages | DFG Portal" }] }),
  component: MessagesPage,
  pendingComponent: () => (
    <main className="max-w-[1100px] mx-auto px-5 md:px-8 pt-20 pb-16 text-muted">Loading...</main>
  ),
});

/* ---------------------------------------------------------------------------
 * MessagesPage
 * --------------------------------------------------------------------------- */

function MessagesPage() {
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();

  const { data: allMessages } = useSuspenseQuery(messagesQuery);

  // Admin: fetch students for name lookup
  const { data: studentsData } = useQuery({ ...adminStudentsQuery, enabled: isAdmin });

  const nameMap = new Map<string, string>();
  if (isAdmin && studentsData) {
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
    mutationFn: async (payload: { recipient_id?: string; body: string }) =>
      unwrap((await api.messages.post(payload)).data),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["messages"] });
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) =>
      unwrap((await api.messages({ id }).patch({ is_read: true })).data),
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
        <ConversationList
          conversations={conversations}
          activePartner={activePartner}
          myId={user.id}
          getName={getName}
          onSelect={selectPartner}
        />

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
