import { Link } from "@tanstack/react-router";
import { Button } from "./Button.js";

export const EmptyState = ({
  message,
  action,
}: {
  message: string;
  action?: { label: string; onClick: () => void } | { label: string; href: string };
}) => (
  <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-overlay/6 bg-card px-6 py-12 text-center">
    <p className="text-muted">{message}</p>
    {!action ? null : "onClick" in action ? (
      <Button variant="outline" onClick={action.onClick}>
        {action.label}
      </Button>
    ) : "href" in action ? (
      <Link to={action.href}>
        <Button variant="outline">{action.label}</Button>
      </Link>
    ) : null}
  </div>
);
