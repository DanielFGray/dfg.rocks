import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import type { Testimonial } from "../../lib/types.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { Textarea } from "../ui/Textarea.js";

function errorMessageFor(error: unknown): string | null {
  return error instanceof Error ? error.message : null;
}

export function TestimonialEditor({
  testimonial,
  onRefresh,
  mode,
}: {
  testimonial: Testimonial | null;
  onRefresh: () => void;
  mode: "dashboard" | "settings";
}) {
  const [body, setBody] = useState(testimonial?.body ?? "");

  useEffect(() => {
    setBody(testimonial?.body ?? "");
  }, [testimonial?.id, testimonial?.body]);

  const saveMutation = useMutation({
    mutationFn: async (nextBody: string) => {
      const { data, error } = await api.testimonials.put({ body: nextBody });
      if (error) throw error;
      return data;
    },
    onSettled: () => {
      onRefresh();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await api.testimonials.delete();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      setBody("");
    },
    onSettled: () => {
      onRefresh();
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
      : "This is what appears on the public site. You can update it anytime.";

  const saveLabel = testimonial
    ? saveMutation.isPending
      ? "Saving..."
      : "Update Testimonial"
    : saveMutation.isPending
      ? "Posting..."
      : "Post Testimonial";

  const errorMessage = errorMessageFor(saveMutation.error) ?? errorMessageFor(deleteMutation.error);

  return (
    <section data-testid={mode === "dashboard" ? "testimonial-prompt" : "testimonial-section"}>
      <Card>
        <div className="gap-4 flex flex-col">
          <div className="gap-1 flex flex-col">
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

          <div className="gap-3 flex items-center justify-between">
            <div className="text-xs text-muted dark:text-muted-dark">
              {testimonial ? (
                <span>
                  Last updated{" "}
                  {new Date(testimonial.updated_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </span>
              ) : (
                <span>Your testimonial will go live as soon as you save it.</span>
              )}
            </div>

            <div className="gap-2 flex">
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
