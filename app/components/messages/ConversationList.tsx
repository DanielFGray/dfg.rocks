import type { Message } from "../../lib/types.js";
import { formatTime, unreadCount } from "./helpers.js";

export function ConversationList({
  conversations,
  activePartner,
  myId,
  getName,
  onSelect,
}: {
  conversations: Map<string, Message[]>;
  activePartner: string | null;
  myId: string;
  getName: (id: string) => string;
  onSelect: (id: string) => () => void;
}) {
  const partnerIds = Array.from(conversations.keys());

  return (
    <div className="w-72 shrink-0 flex flex-col rounded-xl border border-white/[0.06] bg-card overflow-hidden">
      <div className="px-4 py-3 border-b border-white/[0.06] text-sm font-semibold text-muted">
        Conversations
      </div>
      <div className="flex-1 overflow-y-auto">
        {partnerIds.map((pid) => {
          const thread = conversations.get(pid)!;
          const lastMsg = thread[thread.length - 1]!;
          const unread = unreadCount(thread, myId);
          const isActive = pid === activePartner;

          return (
            <button
              key={pid}
              type="button"
              onClick={onSelect(pid)}
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
  );
}
