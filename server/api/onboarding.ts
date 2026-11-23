import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import { Effect } from "effect";
import { withAuthContext } from "../requestDatabase.js";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession } from "../../shared/api/guards.js";
import { Onboarding } from "../services/onboarding.js";
import { adaptSignedInErrors } from "../httpApiErrors.js";

export const OnboardingApiGroupLive = HttpApiBuilder.group(Contract, "onboarding", (handlers) =>
  handlers
    .handle(
      "onboardingState",
      Effect.fnUntraced(function* () {
        const auth = yield* CurrentSession;
        return yield* Onboarding.use((onboarding) =>
          onboarding.state(auth.user.id).pipe(withAuthContext(auth.session.id)),
        );
      }, adaptSignedInErrors),
    )
    .handle(
      "finishOnboarding",
      Effect.fnUntraced(function* ({ payload }) {
        const auth = yield* CurrentSession;
        yield* Onboarding.use((onboarding) =>
          onboarding.finish(auth.user.id, payload).pipe(withAuthContext(auth.session.id)),
        );
        return { success: true as const };
      }, adaptSignedInErrors),
    ),
);
