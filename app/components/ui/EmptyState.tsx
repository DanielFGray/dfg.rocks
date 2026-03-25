import { Button } from "./Button";

type EmptyStateProps = {
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
};

export const EmptyState = ({ message, action }: EmptyStateProps) => (
  <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-white/[0.06] bg-card px-6 py-12 text-center">
    <p className="text-muted">{message}</p>
    {action ? (
      <Button variant="outline" onClick={action.onClick}>
        {action.label}
      </Button>
    ) : null}
  </div>
);
