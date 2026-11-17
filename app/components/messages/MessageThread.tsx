import { useEffect, useRef } from "react";
import type { useMutation } from "@tanstack/react-query";
import type { Message } from "../../../shared/schemas.js";
import { Button } from "../ui/Button.js";
import { formatTime } from "./helpers.js";
import { Link } from "@tanstack/react-router";

export function MessageThread({
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
  sendMessageMutation: ReturnType<
    typeof useMutation<Message, Error, { recipient_id?: string; body: string }>
  >;
  markReadMutation: ReturnType<typeof useMutation<{ success: true }, Error, string>>;
}) {
  const markedRef = useRef(new Set<string>());
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    sentinelRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [thread]);

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
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-overlay/6 px-5 py-3 dark:border-overlay-dark/6">
        <h2 className="text-lg font-semibold text-primary dark:text-primary-dark">
          <Link to="/people/$id" params={{ id: partnerId }}>
            {partnerName}
          </Link>
        </h2>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
        {thread.map((msg) => {
          const isMine = msg.sender_id === myId;
          return (
            <div key={msg.id} className={`flex ${isMine ? "justify-end" : "justify-start"}`}>
              <div
                className={[
                  "max-w-[75%] rounded-xl px-4 py-2.5 text-sm leading-relaxed",
                  isMine
                    ? "bg-accent/20 text-primary dark:text-primary-dark"
                    : "bg-overlay/6 dark:bg-overlay-dark/6 text-primary dark:text-primary-dark",
                ].join(" ")}
              >
                <p className="wrap-break-word whitespace-pre-wrap">{msg.body}</p>
                <p
                  className={`mt-1 text-xs ${isMine ? "text-accent/50" : "text-muted/40 dark:text-muted-dark/40"}`}
                >
                  {formatTime(msg.created_at)}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={sentinelRef} />
      </div>

      {/* Compose */}
      <div className="shrink-0 border-t border-overlay/6 px-5 py-3 dark:border-overlay-dark/6">
        <div className="flex items-end gap-3">
          <textarea
            data-testid="compose-input"
            value={composeText}
            onChange={(e) => setComposeText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Type a message..."
            rows={2}
            className="min-w-0 flex-1 resize-none rounded-lg border border-overlay/10 bg-card px-4 py-3 text-sm text-primary outline-hidden transition-colors placeholder:text-muted/50 focus:border-accent focus:ring-1 focus:ring-accent/50 dark:border-overlay-dark/10 dark:bg-card-dark dark:text-primary-dark dark:placeholder:text-muted-dark/50"
          />
          <Button
            data-testid="send-btn"
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
