import { useState, useRef } from "react";
import { useMove, useSeparator, mergeProps } from "react-aria";
import { Effect } from "effect";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { api } from "../../lib/api.js";
import { useAuth } from "../../lib/hooks/useAuth.js";
import { Button } from "../../components/ui/Button.js";
import { EmptyState } from "../../components/ui/EmptyState.js";
import { groupByPartner } from "../../components/messages/helpers.js";
import { MessageThread } from "../../components/messages/MessageThread.js";
import { ConversationList } from "../../components/messages/ConversationList.js";
import { serverRuntime } from "../../../server/runtime.js";
import { AuthenticatedRouteService } from "../../../server/services/authenticatedRouteService.js";
import { AdminRouteService } from "../../../server/services/adminRouteService.js";
import { serializeMessage, normalizeStudents } from "../../../shared/responseMappers.js";
import { toServerFunctionPayload } from "../../lib/serverFunctionPayload.js";
import { requireSession } from "../../lib/sessionGuards.server.js";

const getMessagesPageData = createServerFn({ method: "GET" }).handler(() =>
  serverRuntime.runPromise(
    Effect.gen(function* () {
      const session = yield* requireSession(getCookie("session"));
      const authSvc = yield* AuthenticatedRouteService;

      const effectiveStudentId =
        session.user.role === "parent" && session.session.active_student_id
          ? session.session.active_student_id
          : undefined;

      const messages = yield* authSvc.messages(
        session.session.id,
        {
          limit: 50,
          offset: 0,
        },
        effectiveStudentId,
      );

      // Explicitly type the messages array to fix inference
      const messagesArray = messages as Array<{
        id: string;
        sender_id: string;
        recipient_id: string;
        body: string;
        is_read: boolean;
        created_at: Date | string;
      }>;
      const serializedMessages: ReturnType<typeof serializeMessage>[] = messagesArray.map(serializeMessage);

      let students: ReturnType<typeof normalizeStudents> | null = null;
      if (session.user.role === "admin") {
        const adminSvc = yield* AdminRouteService;
        students = normalizeStudents(yield* adminSvc.listStudents(session.session.id));
      }

      return toServerFunctionPayload({
        messages: serializedMessages,
        students,
      }) as {
        messages: ReturnType<typeof serializeMessage>[];
        students: ReturnType<typeof normalizeStudents> | null;
      };
    }),
  ),
);

export const Route = createFileRoute("/_authed/messages")({
  head: () => ({ meta: [{ title: "Messages | DFG Portal" }] }),
  loader: () => getMessagesPageData(),
  component: MessagesPage,
  pendingComponent: () => (
    <main className="mx-auto max-w-[1100px] px-5 pt-20 pb-16 text-muted md:px-8 dark:text-muted-dark">
      Loading...
    </main>
  ),
});

/* ---------------------------------------------------------------------------
 * ResizableSidebar
 * --------------------------------------------------------------------------- */

function ResizableSidebar({
  width,
  onWidthChange,
  children,
}: {
  width: number;
  onWidthChange: (w: number) => void;
  children: React.ReactNode;
}) {
  const widthRef = useRef(width);
  widthRef.current = width;

  const { moveProps } = useMove({
    onMoveStart() {
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    onMove(e) {
      const next = Math.max(200, Math.min(500, widthRef.current + e.deltaX));
      widthRef.current = next;
      onWidthChange(next);
    },
    onMoveEnd() {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    },
  });

  const { separatorProps } = useSeparator({ orientation: "vertical" });

  return (
    <div className="flex shrink-0" style={{ width }}>
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      <div
        {...mergeProps(moveProps, separatorProps)}
        tabIndex={0}
        aria-valuenow={width}
        aria-valuemin={200}
        aria-valuemax={500}
        className="relative z-10 -mr-[4px] w-2 shrink-0 cursor-col-resize
          rounded-sm bg-overlay/4
          outline-hidden transition-colors
          hover:bg-accent/20 focus-visible:ring-1 focus-visible:ring-accent
          focus-visible:ring-inset active:bg-accent/40 dark:bg-overlay-dark/4"
      />
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * MessagesPage
 * --------------------------------------------------------------------------- */

function MessagesPage() {
  const router = useRouter();
  const { user, isAdmin } = useAuth();
  const [sidebarWidth, setSidebarWidth] = useState(288);
  const { messages: allMessages, students } = Route.useLoaderData();

  const nameMap = new Map<string, string>();
  if (isAdmin && students) {
    students.forEach((s: { id: string; name: string }) => {
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
    mutationFn: (payload: { recipient_id?: string; body: string }) =>
      Effect.runPromise(api.authenticated.createMessage({ payload })),
    onSettled: () => {
      void router.invalidate();
    },
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) =>
      Effect.runPromise(
        api.authenticated.markMessageRead({
          params: { id },
          payload: { is_read: true },
        }),
      ),
    onSettled: () => {
      void router.invalidate();
    },
  });

  // ---- No conversations: empty or compose ----
  if (conversations.size === 0) {
    if (isAdmin) {
      return (
        <main data-testid="messages" className="mx-auto max-w-[1100px] px-5 pt-20 pb-16 md:px-8">
          <h1 className="mb-8 text-3xl font-bold tracking-tight">Messages</h1>
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
      <main data-testid="messages" className="mx-auto max-w-[1100px] px-5 pt-20 pb-16 md:px-8">
        <h1 className="mb-8 text-3xl font-bold tracking-tight">Messages</h1>
        <div className="rounded-xl border border-overlay/6 bg-card p-5 dark:border-overlay-dark/6 dark:bg-card-dark">
          <p className="mb-4 text-sm text-muted dark:text-muted-dark">
            Send a message to your teacher.
          </p>
          <div className="flex flex-col gap-3">
            <textarea
              data-testid="compose-input"
              value={composeText}
              onChange={(e) => setComposeText(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Type a message..."
              rows={3}
              className="resize-none rounded-lg border border-overlay/10 bg-card px-4 py-3 text-sm text-primary outline-hidden transition-colors placeholder:text-muted/50 focus:border-accent focus:ring-1 focus:ring-accent/50 dark:border-overlay-dark/10 dark:bg-card-dark dark:text-primary-dark dark:placeholder:text-muted-dark/50"
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
    <main data-testid="messages" className="mx-auto max-w-[1100px] px-5 pt-20 pb-16 md:px-8">
      <h1 className="mb-6 text-3xl font-bold tracking-tight">Messages</h1>

      <div className={`flex h-[calc(100vh-12rem)] ${isAdmin ? "gap-0" : "gap-4"}`}>
        {/* Conversation list sidebar */}
        {isAdmin && (
          <ResizableSidebar width={sidebarWidth} onWidthChange={setSidebarWidth}>
            <ConversationList
              conversations={conversations}
              activePartner={activePartner}
              myId={user.id}
              getName={getName}
              onSelect={selectPartner}
            />
          </ResizableSidebar>
        )}

        {/* Thread panel */}
        <div className="flex-1 overflow-hidden rounded-xl border border-overlay/6 bg-card dark:border-overlay-dark/6 dark:bg-card-dark">
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
            <div className="flex h-full items-center justify-center text-muted dark:text-muted-dark">
              Select a conversation
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
