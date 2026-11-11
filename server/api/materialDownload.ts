import * as HttpApiBuilder from "effect/http-api/HttpApiBuilder";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import { Effect } from "effect";
import { Contract } from "../../shared/httpApi.js";
import { adaptHttpApiErrors } from "../httpApiErrors.js";
import { FileService } from "../services/fileService.js";
import { requireSession } from "./raw.js";

const materialDownloadErrorStatuses = [401, 403, 404, 500] as const;

const adaptMaterialDownloadErrors = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  adaptHttpApiErrors(effect, materialDownloadErrorStatuses);

export function makeMaterialDownloadLayer() {
  return HttpApiBuilder.group(Contract, "materialDownload", (handlers) =>
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
