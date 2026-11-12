import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { Effect, Schedule, Stream } from "effect";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import { Realtime } from "../services/realtime.js";
import { resolveEffectiveStudent } from "../services/sessions.js";
import { adaptSignedInErrors } from "../httpApiErrors.js";

export const RealtimeApiGroupLive = HttpApiBuilder.group(Contract, "realtime", (handlers) =>
  handlers.handle(
    "events",
    Effect.fnUntraced(function* () {
      const auth = yield* CurrentSession;
      const effective = resolveEffectiveStudent(auth);
      const userId = auth.user.id;
      const listenerIds = effective.isActing ? [userId, effective.studentId] : [userId];
      const encoder = new TextEncoder();

      const { messages: eventStream } = yield* Realtime;

      const heartbeat = Stream.fromEffectRepeat(
        Effect.succeed(encoder.encode(":heartbeat\n\n")),
      ).pipe(Stream.schedule(Schedule.spaced("15 seconds")));

      const sseStream = eventStream.pipe(
        Stream.filter((msg) => listenerIds.includes(msg.userId)),
        Stream.map((msg) =>
          encoder.encode(
            `data: ${JSON.stringify({ event: msg.event, subject: msg.subject, queryKeys: msg.queryKeys })}\n\n`,
          ),
        ),
        Stream.merge(heartbeat),
      );

      return HttpServerResponse.fromWeb(
        new Response(sseStream.pipe(Stream.toReadableStream()), {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        }),
      );
    }, adaptSignedInErrors),
  ),
);
