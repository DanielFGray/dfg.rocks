import type { BillStatus, PaymentMethod } from "../../../shared/schemas.js";

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function formatCents(cents: number): string {
  return money.format(cents / 100);
}

const dayFormat = {
  month: "short",
  day: "numeric",
  year: "numeric",
} satisfies Intl.DateTimeFormatOptions;

/** A calendar date (YYYY-MM-DD), or the local day of an instant. */
export function dateLabel(value: Date | string): string {
  if (typeof value !== "string") return value.toLocaleDateString("en-US", dayFormat);
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString("en-US", dayFormat);
}

export function dateTimeLabel(value: Date): string {
  return value.toLocaleDateString("en-US", { ...dayFormat, hour: "numeric", minute: "2-digit" });
}

const statusStyles: Record<BillStatus, string> = {
  draft: "bg-overlay/10 text-muted dark:bg-overlay-dark/10 dark:text-muted-dark",
  issued: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  paid: "bg-green-500/15 text-green-700 dark:text-green-300",
  cancelled: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  void: "bg-red-500/15 text-red-700 dark:text-red-300",
};

export function billStatusBadge(status: BillStatus): string {
  const base = "inline-flex rounded-full px-2 py-0.5 text-xs font-medium";
  return `${base} ${statusStyles[status] ?? statusStyles.draft}`;
}

export function statusLabel(status: string): string {
  return status.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}

export const paymentMethodOptions = [
  { value: "cash", label: "Cash" },
  { value: "check", label: "Check" },
  { value: "card", label: "Card" },
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "other", label: "Other" },
];

export function paymentMethodLabel(method: PaymentMethod): string {
  return paymentMethodOptions.find((o) => o.value === method)?.label ?? method;
}
