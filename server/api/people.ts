import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { withAuthContext } from "../requestDatabase.js";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import { People } from "../services/people.js";
import { Lessons } from "../services/lessons.js";
import { serializePersonDetail } from "../../shared/responseMappers.js";
import { adaptAdminErrors } from "../httpApiErrors.js";

/** How many of a person's most recent lessons the person page lists. */
const PERSON_LESSON_LIMIT = 20;

export const PeopleStaffApiGroupLive = HttpApiBuilder.group(Contract, "peopleStaff", (handlers) =>
  handlers
    .handle(
      "people",
      Effect.fnUntraced(function* () {
        const auth = yield* CurrentSession;
        return yield* People.use((people) =>
          people.listPeople().pipe(withAuthContext(auth.session.id)),
        );
      }, adaptAdminErrors),
    )
    .handle(
      "person",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        const [person, families, lessons] = yield* Effect.all([
          People.use((people) => people.getPerson(params.id)),
          People.use((people) => people.personFamilies(params.id)),
          Lessons.use((lessonService) =>
            lessonService.listLessons({
              studentId: params.id,
              limit: PERSON_LESSON_LIMIT,
              offset: 0,
            }),
          ),
        ]).pipe(withAuthContext(auth.session.id));
        return serializePersonDetail({ ...person, families, lessons });
      }, adaptAdminErrors),
    ),
);

export const PeopleAdminApiGroupLive = HttpApiBuilder.group(Contract, "peopleAdmin", (handlers) =>
  handlers.handle(
    "setUserRole",
    Effect.fnUntraced(function* ({ params, payload }) {
      const auth = yield* CurrentSession;
      const user = yield* People.use((people) =>
        people.setUserRole(params.id, payload.role).pipe(withAuthContext(auth.session.id)),
      );
      return { id: user.id, role: user.role };
    }, adaptAdminErrors),
  ),
);
