import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { Effect, Schema as S } from "effect";
import { withAuthContext } from "../requestDatabase.js";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession, type SignedIn } from "../../shared/api/guards.js";
import {
  AssignedMaterial,
  Material,
  type Material as MaterialResponse,
} from "../../shared/schemas.js";
import { adaptHttpApiErrors, adaptSignedInErrors, adaptAdminErrors } from "../httpApiErrors.js";
import { HttpError } from "../pgErrors.js";
import { Materials } from "../services/materials.js";
import { resolveEffectiveStudent } from "../services/sessions.js";
import { Files } from "../services/files.js";

const assertCanManageAssignments = Effect.fnUntraced(function* (auth: SignedIn) {
  if (auth.user.role !== "admin" && auth.user.role !== "teacher") {
    return yield* new HttpError({ status: 403, message: "Forbidden" });
  }
});

const assertCanTrackOwnAssignments = Effect.fnUntraced(function* (auth: SignedIn) {
  if (auth.user.role !== "student" && auth.user.role !== "parent") {
    return yield* new HttpError({ status: 403, message: "Forbidden" });
  }
});

const materialDownloadErrorStatuses = [401, 404, 500] as const;

const adaptMaterialDownloadErrors = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  adaptHttpApiErrors(effect, materialDownloadErrorStatuses);

export const MaterialsApiGroupLive = HttpApiBuilder.group(Contract, "materials", (handlers) =>
  handlers
    .handle(
      "library",
      Effect.fnUntraced(function* ({ query }) {
        const auth = yield* CurrentSession;
        const rows = yield* Materials.use((materialService) =>
          materialService
            .library({
              limit: query.limit ?? 50,
              offset: query.offset ?? 0,
            })
            .pipe(withAuthContext(auth.session.id)),
        );
        return yield* S.decodeUnknownEffect(S.Array(Material))(rows);
      }, adaptSignedInErrors),
    )
    .handle(
      "assignments",
      Effect.fnUntraced(function* () {
        const auth = yield* CurrentSession;
        const effective = resolveEffectiveStudent(auth);
        const filterStudentId = effective.isActing ? effective.studentId : undefined;
        const rows = yield* Materials.use((materialService) =>
          materialService.assignments(filterStudentId).pipe(withAuthContext(auth.session.id)),
        );
        return yield* S.decodeUnknownEffect(S.Array(AssignedMaterial))(rows);
      }, adaptSignedInErrors),
    )
    .handle(
      "assignStudentMaterial",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        yield* assertCanManageAssignments(auth);
        yield* Materials.use((materialService) =>
          materialService
            .assignStudentMaterial({
              studentId: params.studentId,
              materialId: payload.material_id,
              assignedTrackIndex: payload.assigned_track_index,
            })
            .pipe(withAuthContext(auth.session.id)),
        );
        return { success: true as const };
      }, adaptSignedInErrors),
    )
    .handle(
      "unassignStudentMaterial",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        yield* assertCanManageAssignments(auth);
        yield* Materials.use((materialService) =>
          materialService
            .unassignStudentMaterial(params.studentId, params.materialId)
            .pipe(withAuthContext(auth.session.id)),
        );
        return { success: true as const };
      }, adaptSignedInErrors),
    )
    .handle(
      "recordAssignmentPlayback",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        yield* assertCanTrackOwnAssignments(auth);
        const effective = resolveEffectiveStudent(auth);
        const row = yield* Materials.use((materialService) =>
          materialService
            .recordAssignmentPlayback({
              studentId: effective.studentId,
              materialId: params.materialId,
              seconds: payload.seconds,
            })
            .pipe(withAuthContext(auth.session.id)),
        );
        return row;
      }, adaptSignedInErrors),
    )
    .handle(
      "assignmentTracking",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        yield* assertCanTrackOwnAssignments(auth);
        const effective = resolveEffectiveStudent(auth);
        return yield* Materials.use((materialService) =>
          materialService
            .assignmentTracking({ studentId: effective.studentId, materialId: params.materialId })
            .pipe(withAuthContext(auth.session.id)),
        );
      }, adaptSignedInErrors),
    )
    .handle(
      "createAssignmentReview",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        yield* assertCanTrackOwnAssignments(auth);
        const effective = resolveEffectiveStudent(auth);
        const row = yield* Materials.use((materialService) =>
          materialService
            .createAssignmentReview({
              studentId: effective.studentId,
              materialId: params.materialId,
              stars: payload.stars,
            })
            .pipe(withAuthContext(auth.session.id)),
        );
        return row;
      }, adaptSignedInErrors),
    )
    .handle(
      "assignmentNotes",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        const row = yield* Materials.use((materialService) =>
          materialService.assignmentNotes(params.materialId).pipe(withAuthContext(auth.session.id)),
        );
        if (!row) {
          return null;
        }
        return row;
      }, adaptSignedInErrors),
    )
    .handle(
      "upsertAssignmentNotes",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        const effective = resolveEffectiveStudent(auth);
        const row = yield* Materials.use((materialService) =>
          materialService
            .upsertAssignmentNotes({
              studentId: effective.studentId,
              materialId: params.materialId,
              body: payload.body,
            })
            .pipe(withAuthContext(auth.session.id)),
        );
        return row;
      }, adaptSignedInErrors),
    )
    .handle(
      "materialDownload",
      Effect.fnUntraced(function* (context) {
        const auth = yield* CurrentSession;
        const { params } = context;
        const fileInfo = yield* Files.use((fileService) =>
          fileService.download(params.id).pipe(withAuthContext(auth.session.id)),
        );
        return HttpServerResponse.fromWeb(
          new Response(fileInfo.stream as unknown as BodyInit, {
            headers: {
              "content-type": fileInfo.mimeType,
              "content-disposition":
                fileInfo.mimeType === "application/pdf"
                  ? `inline; filename="${encodeURIComponent(fileInfo.filename)}"`
                  : `attachment; filename="${encodeURIComponent(fileInfo.filename)}"`,
            },
          }),
        );
      }, adaptMaterialDownloadErrors),
    ),
);

export const MaterialsAdminApiGroupLive = HttpApiBuilder.group(
  Contract,
  "materialsAdmin",
  (handlers) =>
    handlers
      .handle(
        "assignMaterial",
        Effect.fnUntraced(function* ({ params, payload }) {
          const auth = yield* CurrentSession;
          yield* Materials.use((materialService) =>
            materialService
              .assignMaterial({
                studentId: params.id,
                materialId: payload.material_id,
                assignedTrackIndex: payload.assigned_track_index,
              })
              .pipe(withAuthContext(auth.session.id)),
          );
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "unassignMaterial",
        Effect.fnUntraced(function* (context) {
          const auth = yield* CurrentSession;
          const { params } = context;
          yield* Materials.use((materialService) =>
            materialService
              .unassignMaterial(params.id, params.materialId)
              .pipe(withAuthContext(auth.session.id)),
          );
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "deleteMaterial",
        Effect.fnUntraced(function* (context) {
          const auth = yield* CurrentSession;
          const { params } = context;
          const row = yield* Materials.use((materialService) =>
            materialService.deleteMaterial(params.id).pipe(withAuthContext(auth.session.id)),
          );
          if (!row) {
            return yield* new HttpError({ status: 404, message: "Material not found" });
          }
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "uploadMaterial",
        Effect.fnUntraced(function* ({ payload }) {
          const auth = yield* CurrentSession;
          return (yield* Files.use((fileService) =>
            fileService
              .upload(payload.file, payload.title, payload.visibility, auth.user.id)
              .pipe(withAuthContext(auth.session.id)),
          )) as MaterialResponse;
        }, adaptAdminErrors),
      ),
);
