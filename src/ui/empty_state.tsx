import { Button } from "./button.js";

type EmptyStateProps = {
  message: string;
  action?: {
    label: string;
    onclick: () => void;
  };
};

export const EmptyState = ({ message, action }: EmptyStateProps) => (
  <div class="flex flex-col items-center justify-center gap-4 rounded-xl border border-white/[0.06] bg-card px-6 py-12 text-center">
    <p class="text-muted">{message}</p>
    {action ? (
      <Button variant="outline" onclick={action.onclick}>
        {action.label}
      </Button>
    ) : null}
  </div>
);
