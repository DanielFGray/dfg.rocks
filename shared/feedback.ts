/**
 * The feedback record's shape and field names. Every app that logs feedback uses
 * these names, so one OpenObserve stream serves the feedback records of all of
 * them.
 */
import { Schema as S } from "effect";

export const FeedbackCategory = S.Literals(["bug", "idea", "other"]);
export type FeedbackCategory = S.Schema.Type<typeof FeedbackCategory>;

/** The longest message or contact field the form accepts. */
export const feedbackTextMaxLength = 4000;

/** The longest page URL the form accepts. */
export const feedbackPageUrlMaxLength = 2048;

/**
 * Strips the query string and fragment from a page URL. Reset, verification,
 * deletion and invite links carry their secret in one, so the client strips
 * before sending and the server strips again before logging.
 */
export const stripPageUrl = (url: string): string => {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
};
