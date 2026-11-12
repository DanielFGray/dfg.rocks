import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { withAuthContext } from "../requestDatabase.js";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import { MessageService } from "../services/messageService.js";
import { resolveEffectiveStudent } from "../services/sessionService.js";
import { adaptSignedInErrors } from "../httpApiErrors.js";

export const MessagesApiGroupLive = HttpApiBuilder.group(Contract, "messages", (handlers) =>
  handlers
    .handle(
      "messages",
      Effect.fnUntraced(function* ({ query }) {
        const auth = yield* CurrentSession;
        const effective = resolveEffectiveStudent(auth);
        const filterStudentId = effective.isActing ? effective.studentId : undefined;
        const rows = yield* MessageService.use((messageService) =>
          messageService
            .messages(
              {
                limit: query.limit ?? 50,
                offset: query.offset ?? 0,
                withUser: query.with,
              },
              filterStudentId,
            )
            .pipe(withAuthContext(auth.session.id)),
        );
        return rows;
      }, adaptSignedInErrors),
    )
    .handle(
      "createMessage",
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
        const effective = resolveEffectiveStudent(auth);
        const row = yield* MessageService.use((messageService) =>
          messageService
            .createMessage({
              senderId: effective.studentId,
              recipientId: payload.recipient_id,
              body: payload.body,
            })
            .pipe(withAuthContext(auth.session.id)),
        );
        return row;
      }, adaptSignedInErrors),
    )
    .handle(
      "markMessageRead",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        yield* MessageService.use((messageService) =>
          messageService.markMessageRead(params.id).pipe(withAuthContext(auth.session.id)),
        );
        return { success: true as const };
      }, adaptSignedInErrors),
    ),
);
