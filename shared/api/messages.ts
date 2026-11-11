import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import { Schema as S } from "effect";
import { Message, SuccessResponse } from "../schemas.js";
import { params } from "./fields.js";
import { signedInErrors } from "../httpApiErrors.js";

const MessageListQuery = S.Struct({
  limit: S.optional(S.NumberFromString),
  offset: S.optional(S.NumberFromString),
  with: S.optional(S.String),
});

const CreateMessagePayload = S.Struct({
  recipient_id: S.optional(S.String),
  body: S.String,
});

const MarkMessageReadPayload = S.Struct({
  is_read: S.optional(S.Boolean),
});

export const messagesGroup = HttpApiGroup.make("messages")
  .add(
    HttpApiEndpoint.get("messages", "/messages", {
      error: signedInErrors,
      query: MessageListQuery,
      success: S.Array(Message),
    }),
  )
  .add(
    HttpApiEndpoint.post("createMessage", "/messages", {
      error: signedInErrors,
      payload: CreateMessagePayload,
      success: Message,
    }),
  )
  .add(
    HttpApiEndpoint.patch("markMessageRead", "/messages/:id", {
      error: signedInErrors,
      params: params("id"),
      payload: MarkMessageReadPayload,
      success: SuccessResponse,
    }),
  )
  .prefix("/api");
