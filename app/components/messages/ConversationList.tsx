import type { Message } from "../../../shared/schemas.js";
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
    <div className="flex w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-overlay/6 bg-card dark:border-overlay-dark/6 dark:bg-card-dark">
      <div className="border-b border-overlay/6 px-4 py-3 text-sm font-semibold text-muted dark:border-overlay-dark/6 dark:text-muted-dark">
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
                <span className="truncate text-sm font-semibold text-primary dark:text-primary-dark">
                  {getName(pid)}
                </span>
                <span className="ml-2 shrink-0 text-xs text-muted/40 dark:text-muted-dark/40">
                  {formatTime(lastMsg.created_at)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <p className="max-w-[180px] truncate text-xs text-muted dark:text-muted-dark">
                  {lastMsg.body}
                </p>
                {unread > 0 ? (
                  <span className="ml-2 shrink-0 rounded-full bg-accent/20 px-2 py-0.5 text-xs font-semibold text-accent">
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
