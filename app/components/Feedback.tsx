import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Effect } from "effect";
import { api } from "../lib/api.js";
import { getErrorMessage } from "../lib/errors.js";
import { stripPageUrl } from "../../shared/feedback.js";
import packageJson from "../../package.json" with { type: "json" };
import { Modal } from "./ui/Modal.js";
import { Button } from "./ui/Button.js";
import { Input } from "./ui/Input.js";
import { Select } from "./ui/Select.js";
import { Textarea } from "./ui/Textarea.js";

const categories: Array<{ value: FeedbackCategory; label: string }> = [
  { value: "bug", label: "Bug" },
  { value: "idea", label: "Idea" },
  { value: "other", label: "Other" },
];

type FeedbackPayload = Parameters<typeof api.public.feedback>[0]["payload"];
type FeedbackCategory = Exclude<FeedbackPayload["category"], undefined>;

const isCategory = (value: string): value is FeedbackCategory =>
  categories.some((option) => option.value === value);

/**
 * The feedback link every page shows, and the dialog it opens. The submission
 * goes to /api/feedback, which logs it to the feedback stream; the server adds
 * the user's id from the session.
 */
export const Feedback = () => {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState<FeedbackCategory | "">("");
  const [contact, setContact] = useState("");

  const mutation = useMutation({
    mutationFn: (payload: FeedbackPayload) => Effect.runPromise(api.public.feedback({ payload })),
  });

  const close = () => {
    setOpen(false);
    setMessage("");
    setCategory("");
    setContact("");
    mutation.reset();
  };

  const submit = () => {
    // The required select leaves no category empty in the UI; the server's schema
    // refuses one all the same.
    if (!category) return;
    mutation.mutate({
      message: message.trim(),
      category,
      ...(contact.trim() ? { contact: contact.trim() } : {}),
      // The endpoint strips the URL again before logging, so a token in the
      // query never reaches the log even when this client is not trusted.
      page_url: stripPageUrl(window.location.href),
      app_version: packageJson.version,
    });
  };

  return (
    <>
      <button
        type="button"
        data-testid="feedback-link"
        onClick={() => setOpen(true)}
        className="fixed right-4 bottom-4 z-40 cursor-pointer rounded-full border border-overlay/20 bg-card px-4 py-2 text-sm font-semibold text-primary shadow-lg hover:border-accent hover:text-accent"
      >
        Feedback
      </button>
      <Modal open={open} onClose={close} title="Send feedback">
        {mutation.isSuccess ? (
          <div data-testid="feedback-success" className="flex flex-col gap-4">
            <p className="text-muted">Thanks — your feedback is in.</p>
            <div className="flex justify-end">
              <Button onClick={close}>Done</Button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            data-testid="feedback-form"
            className="flex flex-col gap-4"
          >
            <Textarea
              id="feedback-message"
              name="message"
              label="Message *"
              required
              rows={5}
              value={message}
              onChange={setMessage}
              placeholder="What worked, what broke, what you wish it did..."
              data-testid="feedback-message"
            />
            <Select
              id="feedback-category"
              name="category"
              label="Category *"
              required
              options={categories}
              value={category}
              onChange={(value) => {
                setCategory(isCategory(value) ? value : "");
              }}
              data-testid="feedback-category"
            />
            <Input
              id="feedback-contact"
              name="contact"
              label="Email or phone (optional)"
              value={contact}
              onChange={setContact}
              placeholder="Only if you want a reply"
              data-testid="feedback-contact"
            />
            {/* A field people never see; a bot that fills it is refused. */}
            <input
              type="text"
              name="website"
              style={{ display: "none" }}
              tabIndex={-1}
              autoComplete="off"
            />
            {mutation.isError ? (
              <div
                data-testid="feedback-error"
                role="alert"
                className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-3 text-sm text-red-600 dark:text-red-400"
              >
                {getErrorMessage(mutation.error, "Failed to send feedback")}
              </div>
            ) : null}
            <div className="flex justify-end">
              <Button type="submit" disabled={mutation.isPending} data-testid="feedback-submit">
                {mutation.isPending ? "Sending..." : "Send"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
};
