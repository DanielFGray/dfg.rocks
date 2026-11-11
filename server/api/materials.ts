import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { Effect, Schema as S } from "effect";
import { Contract } from "../../shared/httpApi.js";
import { CurrentSession, type SignedIn } from "../../shared/api/guards.js";
import {
  AssignedMaterial,
  Material,
  type Material as MaterialResponse,
} from "../../shared/schemas.js";
import { adaptHttpApiErrors, adaptSignedInErrors, adaptAdminErrors } from "../httpApiErrors.js";
import { HttpError } from "../pgErrors.js";
import { MaterialService } from "../services/materialService.js";
import { resolveEffectiveStudent } from "../services/sessionService.js";
import { FileService } from "../services/fileService.js";

const assertCanManageAssignments = Effect.fnUntraced(function* (auth: SignedIn) {
  if (auth.user.role !== "admin" && auth.user.role !== "teacher") {
    return yield* new HttpError(403, "Forbidden");
  }
});

const assertCanTrackOwnAssignments = Effect.fnUntraced(function* (auth: SignedIn) {
  if (auth.user.role !== "student" && auth.user.role !== "parent") {
    return yield* new HttpError(403, "Forbidden");
  }
});

const materialDownloadErrorStatuses = [401, 403, 404, 500] as const;

const adaptMaterialDownloadErrors = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  adaptHttpApiErrors(effect, materialDownloadErrorStatuses);

export const MaterialsApiGroupLive = HttpApiBuilder.group(Contract, "materials", (handlers) =>
  handlers
    .handle(
      "library",
      Effect.fnUntraced(function* ({ query }) {
        const auth = yield* CurrentSession;
        const rows = yield* MaterialService.use((materialService) =>
          materialService.library(auth.session.id, {
            limit: query.limit ?? 50,
            offset: query.offset ?? 0,
          }),
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
        const rows = yield* MaterialService.use((materialService) =>
          materialService.assignments(auth.session.id, filterStudentId),
        );
        return yield* S.decodeUnknownEffect(S.Array(AssignedMaterial))(rows);
      }, adaptSignedInErrors),
    )
    .handle(
      "assignStudentMaterial",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        yield* assertCanManageAssignments(auth);
        yield* MaterialService.use((materialService) =>
          materialService.assignStudentMaterial({
            sessionId: auth.session.id,
            studentId: params.studentId,
            materialId: payload.material_id,
            assignedTrackIndex: payload.assigned_track_index,
          }),
        );
        return { success: true as const };
      }, adaptSignedInErrors),
    )
    .handle(
      "unassignStudentMaterial",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        yield* assertCanManageAssignments(auth);
        yield* MaterialService.use((materialService) =>
          materialService.unassignStudentMaterial(
            auth.session.id,
            params.studentId,
            params.materialId,
          ),
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
        const row = yield* MaterialService.use((materialService) =>
          materialService.recordAssignmentPlayback({
            sessionId: auth.session.id,
            studentId: effective.studentId,
            materialId: params.materialId,
            seconds: payload.seconds,
          }),
        );
        return row;
      }, adaptSignedInErrors),
    )
    .handle(
      "createAssignmentReview",
      Effect.fnUntraced(function* ({ params, payload }) {
        const auth = yield* CurrentSession;
        yield* assertCanTrackOwnAssignments(auth);
        const effective = resolveEffectiveStudent(auth);
        const row = yield* MaterialService.use((materialService) =>
          materialService.createAssignmentReview({
            sessionId: auth.session.id,
            studentId: effective.studentId,
            materialId: params.materialId,
            stars: payload.stars,
          }),
        );
        return row;
      }, adaptSignedInErrors),
    )
    .handle(
      "assignmentNotes",
      Effect.fnUntraced(function* ({ params }) {
        const auth = yield* CurrentSession;
        const row = yield* MaterialService.use((materialService) =>
          materialService.assignmentNotes(auth.session.id, params.materialId),
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
        const row = yield* MaterialService.use((materialService) =>
          materialService.upsertAssignmentNotes({
            sessionId: auth.session.id,
            studentId: effective.studentId,
            materialId: params.materialId,
            body: payload.body,
          }),
        );
        return row;
      }, adaptSignedInErrors),
    )
    .handle(
      "materialDownload",
      Effect.fnUntraced(function* (context) {
        const auth = yield* CurrentSession;
        const { params } = context;
        const fileInfo = yield* FileService.use((fileService) =>
          fileService.download(params.id, auth.user.id, auth.session.id),
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
          yield* MaterialService.use((materialService) =>
            materialService.assignMaterial({
              sessionId: auth.session.id,
              studentId: params.id,
              materialId: payload.material_id,
              assignedTrackIndex: payload.assigned_track_index,
            }),
          );
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "unassignMaterial",
        Effect.fnUntraced(function* (context) {
          const auth = yield* CurrentSession;
          const { params } = context;
          yield* MaterialService.use((materialService) =>
            materialService.unassignMaterial(auth.session.id, params.id, params.materialId),
          );
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "deleteMaterial",
        Effect.fnUntraced(function* (context) {
          const auth = yield* CurrentSession;
          const { params } = context;
          const row = yield* MaterialService.use((materialService) =>
            materialService.deleteMaterial(auth.session.id, params.id),
          );
          if (!row) {
            return yield* new HttpError(404, "Material not found");
          }
          return { success: true as const };
        }, adaptAdminErrors),
      )
      .handle(
        "uploadMaterial",
        Effect.fnUntraced(function* ({ payload }) {
          const auth = yield* CurrentSession;
          return (yield* FileService.use((fileService) =>
            fileService.upload(
              payload.file,
              payload.title,
              payload.is_global,
              auth.user.id,
              auth.session.id,
            ),
          )) as MaterialResponse;
        }, adaptAdminErrors),
      ),
);
