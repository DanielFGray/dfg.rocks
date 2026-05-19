import { Button } from "./Button.js";

type EmptyStateProps = {
  message: string;
  action?: {
    label: string;
    onClick: () => void;
  };
};

export const EmptyState = ({ message, action }: EmptyStateProps) => (
  <div className="gap-4 rounded-xl border-overlay/6 dark:border-overlay-dark/6 bg-card dark:bg-card-dark px-6 py-12 flex flex-col items-center justify-center border text-center">
    <p className="text-muted dark:text-muted-dark">{message}</p>
    {action ? (
      <Button variant="outline" onClick={action.onClick}>
        {action.label}
      </Button>
    ) : null}
  </div>
);
