import { Effect, Context, Layer } from "effect";
import { withAuthContext } from "../db.js";
import { HttpError } from "../pgErrors.js";

/** Messages between students and staff. */
export class MessageService extends Context.Service<MessageService>()("MessageService", {
  make: Effect.sync(() => ({
    messages: Effect.fn("messages")(function* (
      sessionId: string,
      values: {
        limit: number;
        offset: number;
        withUser?: string;
      },
      studentId?: string,
    ) {
      return yield* withAuthContext(
        sessionId,
        Effect.fnUntraced(function* (db) {
          let query = db
            .selectFrom("app_public.messages")
            .selectAll()
            .orderBy("created_at", "desc")
            .limit(values.limit)
            .offset(values.offset);
          if (values.withUser) {
            query = query.where((eb) =>
              eb.or([
                eb("sender_id", "=", values.withUser!),
                eb("recipient_id", "=", values.withUser!),
              ]),
            );
          }
          if (studentId) {
            query = query.where((eb) =>
              eb.or([eb("sender_id", "=", studentId), eb("recipient_id", "=", studentId)]),
            );
          }
          return yield* db.execute(query);
        }),
      );
    }),
    createMessage: Effect.fn("createMessage")(function* (values: {
      sessionId: string;
      senderId: string;
      recipientId?: string;
      body: string;
    }) {
      let recipientId = values.recipientId;
      if (!recipientId) {
        const admin = yield* withAuthContext(values.sessionId, (db) =>
          db
            .execute(
              db
                .selectFrom("app_public.users")
                .select("id")
                .where((eb) => eb.or([eb("role", "=", "admin"), eb("role", "=", "teacher")]))
                .limit(1),
            )
            .pipe(
              Effect.head,
              Effect.catchTags({
                NoSuchElementError: () => new HttpError(400, "No staff user found"),
              }),
            ),
        );
        recipientId = admin.id;
      }
      return yield* withAuthContext(values.sessionId, (db) =>
        Effect.head(
          db.execute(
            db
              .insertInto("app_public.messages")
              .values({
                sender_id: values.senderId,
                recipient_id: recipientId,
                body: values.body,
              })
              .returning(["id", "sender_id", "recipient_id", "body", "is_read", "created_at"]),
          ),
        ).pipe(
          Effect.catchTags({
            NoSuchElementError: () => new HttpError(500, "Failed to send message"),
          }),
        ),
      );
    }),
    markMessageRead: Effect.fn("markMessageRead")(function* (sessionId: string, messageId: string) {
      yield* withAuthContext(sessionId, (db) =>
        db.execute(
          db.updateTable("app_public.messages").set({ is_read: true }).where("id", "=", messageId),
        ),
      );
    }),
  })),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
