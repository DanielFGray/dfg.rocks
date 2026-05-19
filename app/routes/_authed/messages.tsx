import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { getMessagesPageData } from "../../lib/routeData.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { Button } from "../../components/ui/Button.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { groupByPartner } from "../../components/messages/helpers.js";
import { MessageThread } from "../../components/messages/MessageThread.js";
import { ConversationList } from "../../components/messages/ConversationList.js";

export const Route = createFileRoute("/_authed/messages")({
  loader: () => getMessagesPageData(),
  head: () => ({ meta: [{ title: "Messages | DFG Portal" }] }),
  component: MessagesPage,
  pendingComponent: () => (
    <main className="px-5 md:px-8 pt-20 pb-16 text-muted dark:text-muted-dark mx-auto max-w-[1100px]">
      Loading...
    </main>
  ),
});

/* ---------------------------------------------------------------------------
 * MessagesPage
 * --------------------------------------------------------------------------- */

function MessagesPage() {
  const { user, isAdmin } = useAuth();
  const router = useRouter();
  const { messages: allMessages, students: studentsData } = Route.useLoaderData();

  const nameMap = new Map<string, string>();
  if (isAdmin && studentsData) {
    studentsData.forEach((s) => {
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
      if (!data || "error" in data) {
        throw new Error(data?.error ?? "Failed to send message");
      }
      return data;
    },
    onSettled: () => {
      void router.invalidate();
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await api.messages({ id }).patch({
        is_read: true,
      });
      if (error) throw error;
      if (!data || "error" in data) {
        throw new Error(data?.error ?? "Failed to mark message read");
      }
      return data;
    },
    onSettled: () => {
      void router.invalidate();
    },
  });

  // ---- No conversations: empty or compose ----
  if (conversations.size === 0) {
    if (isAdmin) {
      return (
        <main data-testid="messages" className="px-5 md:px-8 pt-20 pb-16 mx-auto max-w-[1100px]">
          <h1 className="text-3xl font-bold tracking-tight mb-8">Messages</h1>
          <EmptyState message="No messages yet. Messages with students will appear here." />
        </main>
      );
    }

    // Student with no messages: show compose form
    const onSend = () => {
      const body = composeText.trim();
      if (!body) return;
      sendMessageMutation.mutate(
        { body },
        {
          onSuccess: () => setComposeText(""),
        },
      );
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onSend();
      }
    };

    return (
      <main data-testid="messages" className="px-5 md:px-8 pt-20 pb-16 mx-auto max-w-[1100px]">
        <h1 className="text-3xl font-bold tracking-tight mb-8">Messages</h1>
        <div className="rounded-xl border-overlay/6 dark:border-overlay-dark/6 bg-card dark:bg-card-dark p-5 border">
          <p className="text-muted dark:text-muted-dark text-sm mb-4">
            Send a message to your teacher.
          </p>
          <div className="gap-3 flex flex-col">
            <textarea
              data-testid="compose-input"
              value={composeText}
              onChange={(e) => setComposeText(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Type a message..."
              rows={3}
              className="rounded-lg border-overlay/10 dark:border-overlay-dark/10 bg-card dark:bg-card-dark px-4 py-3 text-primary dark:text-primary-dark placeholder:text-muted/50 dark:placeholder:text-muted-dark/50 focus:border-accent focus:ring-accent/50 text-sm resize-none border transition-colors outline-hidden focus:ring-1"
            />
            <div className="flex justify-end">
              <Button data-testid="send-btn" onClick={onSend} disabled={!composeText.trim()}>
                Send
              </Button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  const activeThread = activePartner ? (conversations.get(activePartner) ?? []) : [];

  return (
    <main data-testid="messages" className="px-5 md:px-8 pt-20 pb-16 mx-auto max-w-[1100px]">
      <h1 className="text-3xl font-bold tracking-tight mb-6">Messages</h1>

      <div className="gap-4 flex h-[calc(100vh-12rem)]">
        {/* Conversation list sidebar */}
        {isAdmin && (
          <ConversationList
            conversations={conversations}
            activePartner={activePartner}
            myId={user.id}
            getName={getName}
            onSelect={selectPartner}
          />
        )}

        {/* Thread panel */}
        <div className="rounded-xl border-overlay/6 dark:border-overlay-dark/6 bg-card dark:bg-card-dark flex-1 overflow-hidden border">
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
            <div className="text-muted dark:text-muted-dark flex h-full items-center justify-center">
              Select a conversation
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
