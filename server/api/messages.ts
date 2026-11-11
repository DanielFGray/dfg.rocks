import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { Contract } from "../../shared/httpApi.js";
import { AuthenticatedRouteService } from "../services/authenticatedRouteService.js";
import { resolveEffectiveStudent } from "../services/sessionService.js";
import { requireSession } from "./raw.js";
import { adaptSignedInErrors } from "../httpApiErrors.js";

export const MessagesApiGroupLive = HttpApiBuilder.group(Contract, "messages", (handlers) =>
  handlers
    .handle(
      "messages",
      Effect.fnUntraced(function* ({ request, query }) {
        const auth = yield* requireSession(request);
        const effective = resolveEffectiveStudent(auth);
        const filterStudentId = effective.isActing ? effective.studentId : undefined;
        const rows = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
          authenticatedRouteService.messages(
            auth.session.id,
            {
              limit: query.limit ?? 50,
              offset: query.offset ?? 0,
              withUser: query.with,
            },
            filterStudentId,
          ),
        );
        return rows.map((row) => ({
          ...row,
          created_at: row.created_at.toISOString(),
        }));
      }, adaptSignedInErrors),
    )
    .handle(
      "createMessage",
      Effect.fnUntraced(function* ({ request, payload }) {
        const auth = yield* requireSession(request);
        const effective = resolveEffectiveStudent(auth);
        const row = yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
          authenticatedRouteService.createMessage({
            sessionId: auth.session.id,
            senderId: effective.studentId,
            recipientId: payload.recipient_id,
            body: payload.body,
          }),
        );
        return {
          ...row,
          created_at: row.created_at.toISOString(),
        };
      }, adaptSignedInErrors),
    )
    .handle(
      "markMessageRead",
      Effect.fnUntraced(function* ({ request, params }) {
        const auth = yield* requireSession(request);
        yield* AuthenticatedRouteService.use((authenticatedRouteService) =>
          authenticatedRouteService.markMessageRead(auth.session.id, params.id),
        );
        return { success: true as const };
      }, adaptSignedInErrors),
    ),
);
