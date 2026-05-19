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
    <div className="w-72 rounded-xl border-overlay/6 dark:border-overlay-dark/6 bg-card dark:bg-card-dark flex shrink-0 flex-col overflow-hidden border">
      <div className="px-4 py-3 border-overlay/6 dark:border-overlay-dark/6 text-sm font-semibold text-muted dark:text-muted-dark border-b">
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
              data-testid={`conv-${pid}`}
              className={[
                "w-full text-left px-4 py-3 border-b border-overlay/4 dark:border-overlay-dark/4 transition-colors cursor-pointer",
                isActive
                  ? "bg-overlay/8 dark:bg-overlay-dark/8"
                  : "hover:bg-overlay/4 dark:hover:bg-overlay-dark/4",
              ].join(" ")}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="font-semibold text-sm text-primary dark:text-primary-dark truncate">
                  {getName(pid)}
                </span>
                <span className="text-xs text-muted/40 dark:text-muted-dark/40 ml-2 shrink-0">
                  {formatTime(lastMsg.created_at)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted dark:text-muted-dark max-w-[180px] truncate">
                  {lastMsg.body}
                </p>
                {unread > 0 ? (
                  <span className="bg-accent/20 px-2 py-0.5 text-xs font-semibold text-accent ml-2 shrink-0 rounded-full">
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
