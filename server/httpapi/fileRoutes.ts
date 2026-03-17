import { Effect } from "effect";
import { SessionService } from "../services/sessionService.js";
import { FileService, FileServiceError } from "../services/fileService.js";

const UPLOAD_PATTERN = /^\/api\/admin\/materials\/upload$/;
const DOWNLOAD_PATTERN = /^\/api\/materials\/([0-9a-f-]+)\/download$/;

function parseCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match?.[1];
}

const getSessionFromRequest = (request: Request) =>
  Effect.gen(function* () {
    const cookieHeader = request.headers.get("cookie");
    const token = parseCookie(cookieHeader, "session");
    return yield* SessionService.validateSessionToken(token);
  });

const requireAuth = (request: Request) =>
  Effect.gen(function* () {
    const { user, session } = yield* getSessionFromRequest(request);
    if (!user || !session) {
      return yield* Effect.fail(new FileServiceError("Not authenticated", 401));
    }
    return { user, session };
  });

const requireAdminAuth = (request: Request) =>
  Effect.gen(function* () {
    const { user, session } = yield* requireAuth(request);
    if (user.role !== "admin") {
      return yield* Effect.fail(
        new FileServiceError("Admin access required", 403),
      );
    }
    return { user, session };
  });

const requireCsrfHeader = (request: Request) =>
  Effect.gen(function* () {
    const header = request.headers.get("x-requested-with");
    if (!header) {
      return yield* Effect.fail(
        new FileServiceError("Missing X-Requested-With header", 400),
      );
    }
  });

function errorResponse(error: FileServiceError): Response {
  return Response.json({ error: error.message }, { status: error.status });
}

function internalErrorResponse(): Response {
  return Response.json({ error: "Internal server error" }, { status: 500 });
}

const handleUpload = (request: Request) =>
  Effect.gen(function* () {
    yield* requireCsrfHeader(request);
    const { user } = yield* requireAdminAuth(request);

    const formData = yield* Effect.tryPromise({
      try: () => request.formData(),
      catch: () => new FileServiceError("Invalid form data"),
    });

    const file = formData.get("file");
    if (!file || !(file instanceof File)) {
      return yield* Effect.fail(new FileServiceError("No file provided"));
    }

    const title = formData.get("title");
    if (!title || typeof title !== "string") {
      return yield* Effect.fail(new FileServiceError("Title is required"));
    }

    const isGlobalRaw = formData.get("is_global");
    const isGlobal = isGlobalRaw === "true" || isGlobalRaw === "1";

    const material = yield* FileService.upload(file, title, isGlobal, user.id);

    return Response.json(material, { status: 201 });
  });

const handleDownload = (request: Request, materialId: string) =>
  Effect.gen(function* () {
    const { user } = yield* requireAuth(request);

    const fileInfo = yield* FileService.download(materialId, user.id);

    const bunFile = Bun.file(fileInfo.path);
    const stream = bunFile.stream();

    return new Response(stream, {
      headers: {
        "content-type": fileInfo.mimeType,
        "content-disposition": `attachment; filename="${encodeURIComponent(fileInfo.filename)}"`,
      },
    });
  });

/**
 * Handle file upload/download routes outside of HttpApi.
 * Returns a Response for matched routes, or null to pass through to HttpApi.
 */
export const handleFileRoutes = (request: Request) =>
  Effect.gen(function* () {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // POST /api/admin/materials/upload
    if (request.method === "POST" && UPLOAD_PATTERN.test(pathname)) {
      return yield* handleUpload(request).pipe(
        Effect.catchTag("FileServiceError", (e) =>
          Effect.succeed(errorResponse(e)),
        ),
        Effect.catchAll(() => Effect.succeed(internalErrorResponse())),
      );
    }

    // GET /api/materials/:id/download
    if (request.method === "GET") {
      const match = pathname.match(DOWNLOAD_PATTERN);
      if (match?.[1]) {
        return yield* handleDownload(request, match[1]).pipe(
          Effect.catchTag("FileServiceError", (e) =>
            Effect.succeed(errorResponse(e)),
          ),
          Effect.catchAll(() => Effect.succeed(internalErrorResponse())),
        );
      }
    }

    return null;
  });
