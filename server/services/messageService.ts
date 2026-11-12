import { Effect, Context, Layer } from "effect";
import { RequestDatabase } from "../requestDatabase.js";
import { HttpError } from "../pgErrors.js";

/** Messages between students and staff. */
export class MessageService extends Context.Service<MessageService>()("MessageService", {
  make: Effect.sync(() => ({
    messages: Effect.fn("messages")(function* (
      values: {
        limit: number;
        offset: number;
        withUser?: string;
      },
      studentId?: string,
    ) {
      const db = yield* RequestDatabase;
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
    createMessage: Effect.fn("createMessage")(function* (values: {
      senderId: string;
      recipientId?: string;
      body: string;
    }) {
      const db = yield* RequestDatabase;
      let recipientId = values.recipientId;
      if (!recipientId) {
        const admin = yield* db
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
          );
        recipientId = admin.id;
      }
      return yield* Effect.head(
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
      );
    }),
    markMessageRead: Effect.fn("markMessageRead")(function* (messageId: string) {
      const db = yield* RequestDatabase;
      yield* db.execute(
        db.updateTable("app_public.messages").set({ is_read: true }).where("id", "=", messageId),
      );
    }),
  })),
}) {
  static readonly layer = Layer.effect(this, this.make);
}
