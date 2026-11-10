import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { Effect } from "effect";
import {
  ForbiddenErrorSchema,
  InternalServerErrorSchema,
  NotFoundErrorSchema,
  UnauthorizedErrorSchema,
} from "../../shared/httpApiErrors.js";
import { adaptHttpApiErrors } from "../httpApiErrors.js";
import { FileService } from "../services/fileService.js";
import { params, requireSession } from "./raw.js";

const materialDownloadErrors = [
  UnauthorizedErrorSchema,
  ForbiddenErrorSchema,
  NotFoundErrorSchema,
  InternalServerErrorSchema,
] as const;

export const materialDownloadGroup = HttpApiGroup.make("materialDownload")
  .add(
    HttpApiEndpoint.get("materialDownload", "/materials/:id/download", {
      error: materialDownloadErrors,
      params: params("id"),
    }),
  )
  .prefix("/api");

const materialDownloadApi = HttpApi.make("dfg").add(materialDownloadGroup);

const materialDownloadErrorStatuses = [401, 403, 404, 500] as const;

const adaptMaterialDownloadErrors = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  adaptHttpApiErrors(effect, materialDownloadErrorStatuses);

export function makeMaterialDownloadLayer() {
  return HttpApiBuilder.group(materialDownloadApi, "materialDownload", (handlers) =>
    handlers.handle(
      "materialDownload",
      Effect.fnUntraced(function* (context) {
        const auth = yield* requireSession(context.request);
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
}
