import { Effect } from "effect";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { getErrorMessage } from "../../lib/errors.js";
import type { Testimonial } from "../../../shared/schemas.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { Textarea } from "../ui/Textarea.js";

function errorMessageFor(error: unknown): string | null {
  return getErrorMessage(error, "");
}

/** Render it with `key={testimonial?.id}`, so another testimonial starts from its own text. */
export function TestimonialEditor({
  testimonial,
  onRefresh,
  mode,
}: {
  testimonial: Testimonial | null;
  onRefresh: () => Promise<void>;
  mode: "dashboard" | "settings";
}) {
  const [body, setBody] = useState(testimonial?.body ?? "");

  const saveMutation = useMutation({
    mutationFn: (nextBody: string) =>
      Effect.runPromise(api.testimonials.upsertTestimonial({ payload: { body: nextBody } })),
    onSuccess: onRefresh,
  });

  const deleteMutation = useMutation({
    mutationFn: () => Effect.runPromise(api.testimonials.deleteTestimonial()),
    onSuccess: async () => {
      setBody("");
      await onRefresh();
    },
  });

  const trimmedBody = body.trim();
  const initialBody = testimonial?.body.trim() ?? "";
  const canSave =
    trimmedBody.length >= 20 &&
    trimmedBody.length <= 2000 &&
    trimmedBody !== initialBody &&
    !saveMutation.isPending &&
    !deleteMutation.isPending;

  const title = mode === "dashboard" ? "Share your experience" : "Public Testimonial";
  const description =
    mode === "dashboard"
      ? "Help future students and parents know what lessons have been like for you."
      : "Approved testimonials appear on the public site after admin review. You can update yours anytime.";

  const saveLabel = testimonial
    ? saveMutation.isPending
      ? "Saving..."
      : "Update Testimonial"
    : saveMutation.isPending
      ? "Posting..."
      : "Post Testimonial";

  const errorMessage =
    errorMessageFor(saveMutation.error) || errorMessageFor(deleteMutation.error) || null;
  const approvalMessage = testimonial
    ? testimonial.is_approved
      ? "Approved for public display."
      : "Pending admin approval before it appears on the public site."
    : "Your testimonial will be reviewed by an admin before it appears on the public site.";

  return (
    <section data-testid={mode === "dashboard" ? "testimonial-prompt" : "testimonial-section"}>
      <Card>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold">{title}</h2>
            <p className="text-sm text-muted dark:text-muted-dark">{description}</p>
            <p className="text-xs text-muted dark:text-muted-dark">
              20-2000 characters. Your name and account role will be shown with it publicly.
            </p>
          </div>

          <Textarea
            id={`testimonial-${mode}`}
            name="testimonial"
            label="Your testimonial"
            rows={5}
            value={body}
            onChange={setBody}
            placeholder="What has your experience been like?"
            data-testid="testimonial-textarea"
          />

          <div className="flex items-center justify-between gap-3">
            <div className="text-xs text-muted dark:text-muted-dark">
              {testimonial ? (
                <span>
                  {approvalMessage} Last updated{" "}
                  {testimonial.updated_at.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              ) : (
                <span>{approvalMessage}</span>
              )}
            </div>

            <div className="flex gap-2">
              {testimonial ? (
                <Button
                  variant="ghost"
                  onClick={() => deleteMutation.mutate()}
                  disabled={saveMutation.isPending || deleteMutation.isPending}
                  data-testid="delete-testimonial"
                >
                  {deleteMutation.isPending ? "Removing..." : "Remove"}
                </Button>
              ) : null}
              <Button
                onClick={() => saveMutation.mutate(trimmedBody)}
                disabled={!canSave}
                data-testid="save-testimonial"
              >
                {saveLabel}
              </Button>
            </div>
          </div>

          {errorMessage ? (
            <p className="text-sm text-red-600 dark:text-red-400">{errorMessage}</p>
          ) : null}
        </div>
      </Card>
    </section>
  );
}
