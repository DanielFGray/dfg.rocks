import { useState, useEffect, useRef } from "react";
import type { useMutation } from "@tanstack/react-query";
import type { Message } from "../../lib/types.js";
import { Button } from "../ui/Button.js";
import { formatTime } from "./helpers.js";

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
