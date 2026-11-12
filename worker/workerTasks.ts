import { Context, Effect, Layer, Schema } from "effect";
import { EmailDelivery, QueuedEmail } from "./email/emailDelivery.js";
import { CalendarSync, CalendarSyncJob } from "./calendar/calendarSync.js";

/** Decodes queued payloads before handing them to their feature. */
export class WorkerTasks extends Context.Service<WorkerTasks>()("dfg-rocks/workerTasks", {
  make: Effect.gen(function* () {
    const delivery = yield* EmailDelivery;
    const calendar = yield* CalendarSync;
    return {
      send_email: (input: unknown) =>
        Schema.decodeUnknownEffect(QueuedEmail)(input).pipe(Effect.flatMap(delivery.send)),
      lessons__sync_calendar_event: (input: unknown) =>
        Schema.decodeUnknownEffect(CalendarSyncJob)(input).pipe(Effect.flatMap(calendar.sync)),
    };
  }),
}) {
  static readonly layerNoDeps = Layer.effect(this, this.make);
  static readonly layer = this.layerNoDeps.pipe(
    Layer.provide(Layer.mergeAll(EmailDelivery.layer, CalendarSync.layer)),
  );
}
