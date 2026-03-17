/**
 * DfgApi — type-safe API client generated from HttpApi contract
 *
 * Uses AtomHttpApi.Tag to derive query/mutation atoms and an imperative
 * HttpApiClient from the shared DfgPortalApi contract.
 *
 * Components access the client via `yield* DfgApi` and call methods like:
 *   api.authenticated.courses({})
 *   api.auth.login({ payload: { id, password } })
 *   api.admin.createCourse({ payload: { title, instrument } })
 */
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type { Schema } from "effect";
import { HttpClient, HttpClientRequest, FetchHttpClient } from "@effect/platform";
import { AtomHttpApi } from "@effect-atom/atom";
import { DfgPortalApi } from "../../shared/contract.js";
import {
  UserResponse,
  CourseResponse,
  ModuleResponse,
  MaterialResponse,
  CourseDetailResponse,
  StudentDetailResponse,
  SubmissionResponse,
  PracticeLogResponse,
  AssignmentNoteResponse,
  MessageResponse,
} from "../../shared/schemas.js";

// === Type aliases (derived from shared schemas) ===

export type User = Schema.Schema.Type<typeof UserResponse>;
export type Course = Schema.Schema.Type<typeof CourseResponse>;
export type Module = Schema.Schema.Type<typeof ModuleResponse> & {
  readonly materials: readonly Material[];
};
export type Material = Schema.Schema.Type<typeof MaterialResponse>;
export type CourseDetail = Schema.Schema.Type<typeof CourseDetailResponse>;
export type StudentDetail = Schema.Schema.Type<typeof StudentDetailResponse>;
export type Submission = Schema.Schema.Type<typeof SubmissionResponse>;
export type PracticeLog = Schema.Schema.Type<typeof PracticeLogResponse>;
export type AssignmentNote = Schema.Schema.Type<typeof AssignmentNoteResponse>;
export type Message = Schema.Schema.Type<typeof MessageResponse>;

// === DfgApi — AtomHttpApi.Tag wrapping DfgPortalApi ===

export interface DfgApi {
  readonly _: unique symbol;
}
export const DfgApi = AtomHttpApi.Tag<DfgApi>()("DfgApi", {
  api: DfgPortalApi,
  httpClient: FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(FetchHttpClient.RequestInit, { credentials: "include" as const }),
    ),
  ),
  transformClient: (client) =>
    client.pipe(
      HttpClient.mapRequest(
        HttpClientRequest.setHeader("X-Requested-With", "fibrae"),
      ),
    ),
});

// === File upload (multipart — can't go through HttpApiClient) ===

export const uploadMaterial = (
  file: File,
  title: string,
  isGlobal: boolean,
): Effect.Effect<Material, Error> =>
  Effect.tryPromise({
    try: async () => {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", title);
      formData.append("is_global", isGlobal ? "true" : "false");
      const res = await fetch("/api/admin/materials/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
        headers: { "X-Requested-With": "fibrae" },
      });
      if (!res.ok) {
        const data: unknown = await res.json();
        const msg =
          data !== null &&
          typeof data === "object" &&
          "error" in data &&
          typeof (data as Record<string, unknown>).error === "string"
            ? (data as Record<string, string>).error
            : "Upload failed";
        throw new Error(msg);
      }
      return (await res.json()) as Material;
    },
    catch: (err) => (err instanceof Error ? err : new Error("Upload failed")),
  });
