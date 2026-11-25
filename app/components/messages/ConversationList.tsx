import { GridList, GridListItem } from "react-aria-components";
import { cn } from "tailwind-variants";
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
  onSelect: (id: string) => void;
}) {
  const partnerIds = Array.from(conversations.keys());

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-overlay/6 bg-card">
      <div
        id="conversation-list-heading"
        className="border-b border-overlay/6 px-4 py-3 text-sm font-semibold text-muted"
      >
        Conversations
      </div>
      <GridList
        aria-labelledby="conversation-list-heading"
        selectionMode="single"
        selectionBehavior="replace"
        disallowEmptySelection
        selectedKeys={activePartner ? [activePartner] : []}
        onSelectionChange={(keys) => {
          if (keys === "all") return;
          const id = keys.values().next().value;
          if (id != null) onSelect(String(id));
        }}
        className="min-h-0 flex-1 overflow-y-auto outline-hidden"
      >
        {partnerIds.map((pid) => {
          const thread = conversations.get(pid)!;
          const lastMsg = thread[thread.length - 1]!;
          const unread = unreadCount(thread, myId);

          return (
            <GridListItem
              key={pid}
              id={pid}
              textValue={getName(pid)}
              data-testid={`conv-${pid}`}
              className={cn(
                "w-full cursor-pointer border-b border-overlay/4 px-4 py-3 text-left transition-colors",
                "hover:bg-overlay/4",
                "data-selected:bg-overlay/8",
                "data-focus-visible:ring-1 data-focus-visible:ring-inset data-focus-visible:ring-accent",
              )}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="text-sm font-semibold text-primary">{getName(pid)}</span>
                <span className="ml-2 shrink-0 text-xs text-muted/40">
                  {formatTime(lastMsg.created_at)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <p className="min-w-0 truncate text-xs text-muted">{lastMsg.body}</p>
                {unread > 0 ? (
                  <span className="ml-2 shrink-0 rounded-full bg-accent/20 px-2 py-0.5 text-xs font-semibold text-accent">
                    {unread}
                  </span>
                ) : null}
              </div>
            </GridListItem>
          );
        })}
      </GridList>
    </div>
  );
}
