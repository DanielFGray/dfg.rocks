import type { BillingModel } from "../../shared/schemas.js";

// -- Type exports --

export type LineCategory = "tuition" | "fees";

export type DiscountType = "percentage" | "fixed";

export type DiscountApplicability = "all" | "tuition" | "fees";

export interface DiscountConfig {
  discountType: DiscountType;
  discountValue: number;
  appliesTo: DiscountApplicability;
}

export interface TaxRateConfig {
  ratePercent: number;
  appliesTo: DiscountApplicability;
}

export interface EffectiveDatedRate {
  rateCents: number;
  lessonDurationMinutes: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
}

export interface MonthlyOccurrenceInput {
  dayOfWeek: number;
  timezone: string;
  startsOn: string;
  endsOn: string | null;
  billingMonth: string;
}

export interface BillForAllocation {
  id: string;
  totalCents: number;
  adjustmentsCents: number;
  creditsAppliedCents: number;
  paidCents: number;
  dueDate: string | null;
  status: string;
}

export interface PaymentAllocation {
  billId: string;
  amountCents: number;
}

export interface SingleBookingDepositOutcome {
  billingModel: "single_booking";
  depositCents: number;
}

export interface MonthlyPrepaidOutcome {
  billingModel: "monthly_prepaid";
}

export type BookingOutcome = SingleBookingDepositOutcome | MonthlyPrepaidOutcome;

// -- Cent validation --

export function assertCents(value: number, label: string = "value"): number {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${label} must be an integer number of cents`);
  }
  return value;
}

export function assertNonNegativeCents(value: number, label: string = "value"): number {
  assertCents(value, label);
  if (value < 0) {
    throw new Error(`${label} must be non-negative`);
  }
  return value;
}

export function assertPositiveCents(value: number, label: string = "value"): number {
  assertCents(value, label);
  if (value <= 0) {
    throw new Error(`${label} must be positive`);
  }
  return value;
}

// -- Half-up rounding --

export function roundCents(value: number): number {
  if (!Number.isFinite(value)) throw new Error("value must be finite");
  return value >= 0 ? Math.floor(value + 0.5) : Math.ceil(value - 0.5);
}

// -- Discount calculation --

export function calculateDiscount(
  lineItems: { amountCents: number; category: LineCategory }[],
  discounts: DiscountConfig[],
): number {
  let totalDiscount = 0;
  for (const discount of discounts) {
    if (!Number.isFinite(discount.discountValue) || discount.discountValue < 0) {
      throw new Error("discount.discountValue must be non-negative");
    }
    if (discount.discountType === "fixed") {
      const applicableBase = lineItems
        .filter((li) => discount.appliesTo === "all" || li.category === discount.appliesTo)
        .reduce((sum, li) => sum + assertCents(li.amountCents, "line item amount"), 0);
      totalDiscount += Math.min(Math.round(discount.discountValue), applicableBase);
    } else {
      const applicableBase = lineItems
        .filter((li) => discount.appliesTo === "all" || li.category === discount.appliesTo)
        .reduce((sum, li) => sum + assertCents(li.amountCents, "line item amount"), 0);
      totalDiscount += roundCents((applicableBase * discount.discountValue) / 100);
    }
  }
  return totalDiscount;
}

// -- Line-level tax --

export function calculateLineTax(
  lineItems: { amountCents: number; category: LineCategory }[],
  taxRates: TaxRateConfig[],
): number {
  let totalTax = 0;
  for (const rate of taxRates) {
    if (!Number.isFinite(rate.ratePercent) || rate.ratePercent < 0 || rate.ratePercent > 30) {
      throw new Error("tax rate must be between 0 and 30 percent");
    }
    for (const line of lineItems) {
      if (rate.appliesTo !== "all" && line.category !== rate.appliesTo) continue;
      const amountCents = assertCents(line.amountCents, "line item amount");
      totalTax += roundCents((amountCents * rate.ratePercent) / 100);
    }
  }
  return totalTax;
}

// -- Monthly occurrence dates --

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function getMonthlyOccurrenceDates(input: MonthlyOccurrenceInput): string[] {
  const { dayOfWeek, startsOn, endsOn, billingMonth } = input;

  const [yearStr, monthStr] = billingMonth.split("-");
  const year = Number.parseInt(yearStr, 10);
  const monthIndex = Number.parseInt(monthStr, 10) - 1;

  const scheduleStart = new Date(`${startsOn}T00:00:00.000Z`);
  const scheduleEnd = endsOn ? new Date(`${endsOn}T23:59:59.999Z`) : null;

  const jsDow = dayOfWeek % 7;

  const firstOfMonth = new Date(Date.UTC(year, monthIndex, 1));
  const firstDow = firstOfMonth.getUTCDay();

  let dayOffset = jsDow - firstDow;
  if (dayOffset < 0) dayOffset += 7;

  const dates: string[] = [];
  let dayNum = 1 + dayOffset;

  while (true) {
    const date = new Date(Date.UTC(year, monthIndex, dayNum));
    if (date.getUTCMonth() !== monthIndex) break;

    if (date >= scheduleStart && (!scheduleEnd || date <= scheduleEnd)) {
      dates.push(date.toISOString().slice(0, 10));
    }

    dayNum += 7;
  }

  return dates;
}

// -- Effective-dated rate selection --

export function selectEffectiveRate(
  rates: EffectiveDatedRate[],
  date: string,
): EffectiveDatedRate | null {
  if (!isIsoDate(date)) {
    throw new Error(`date must be an ISO date (YYYY-MM-DD): ${date}`);
  }

  const target = new Date(`${date}T00:00:00.000Z`);

  const applicable = rates.filter((r) => {
    if (!isIsoDate(r.effectiveFrom)) return false;
    const from = new Date(`${r.effectiveFrom}T00:00:00.000Z`);
    if (target < from) return false;
    if (r.effectiveUntil !== null) {
      if (!isIsoDate(r.effectiveUntil)) return false;
      const until = new Date(`${r.effectiveUntil}T00:00:00.000Z`);
      if (target > until) return false;
    }
    return true;
  });

  if (applicable.length === 0) return null;

  applicable.sort(
    (a, b) =>
      new Date(`${b.effectiveFrom}T00:00:00.000Z`).getTime() -
      new Date(`${a.effectiveFrom}T00:00:00.000Z`).getTime(),
  );

  return applicable[0];
}

// -- Single-booking / deposit outcomes --

export function calculateDepositAmount(rateCents: number, denominator = 3): number {
  assertPositiveCents(rateCents, "rateCents");
  if (!Number.isInteger(denominator) || denominator <= 0) {
    throw new Error("deposit denominator must be a positive integer");
  }
  return Math.ceil(rateCents / denominator);
}

export function resolveBookingOutcome(
  billingModel: BillingModel,
  rateCents: number,
): BookingOutcome {
  if (billingModel === "monthly_prepaid") {
    return { billingModel: "monthly_prepaid" };
  }
  return {
    billingModel: "single_booking",
    depositCents: calculateDepositAmount(rateCents),
  };
}

// -- Oldest-first payment allocation --

function outstandingCents(bill: BillForAllocation): number {
  return Math.max(
    0,
    bill.totalCents + bill.adjustmentsCents - bill.creditsAppliedCents - bill.paidCents,
  );
}

export function allocatePayment(input: {
  paymentAmountCents: number;
  bills: BillForAllocation[];
  explicitAllocations?: PaymentAllocation[];
}): PaymentAllocation[] {
  const { paymentAmountCents, bills, explicitAllocations } = input;
  assertPositiveCents(paymentAmountCents, "paymentAmountCents");

  const openBills = bills
    .filter((b) => b.status === "issued" || b.status === "paid")
    .filter((b) => outstandingCents(b) > 0);

  if (explicitAllocations && explicitAllocations.length > 0) {
    for (const allocation of explicitAllocations) {
      assertPositiveCents(allocation.amountCents, "allocation.amountCents");
    }
    const explicitTotal = explicitAllocations.reduce((s, a) => s + a.amountCents, 0);
    if (explicitTotal > paymentAmountCents) {
      throw new Error("Explicit allocations exceed payment amount");
    }

    for (const alloc of explicitAllocations) {
      const bill = openBills.find((b) => b.id === alloc.billId);
      if (!bill) {
        throw new Error(`Bill not found among open bills: ${alloc.billId}`);
      }
      if (alloc.amountCents > outstandingCents(bill)) {
        throw new Error(`Allocation exceeds outstanding balance for bill ${alloc.billId}`);
      }
    }

    const allocations = new Map<string, number>();
    for (const allocation of explicitAllocations) {
      allocations.set(
        allocation.billId,
        (allocations.get(allocation.billId) ?? 0) + allocation.amountCents,
      );
    }
    const remaining = paymentAmountCents - explicitTotal;
    if (remaining > 0) {
      const adjustedBills = openBills.map((bill) => ({
        ...bill,
        paidCents: bill.paidCents + (allocations.get(bill.id) ?? 0),
      }));
      for (const allocation of oldestFirst(remaining, adjustedBills)) {
        allocations.set(
          allocation.billId,
          (allocations.get(allocation.billId) ?? 0) + allocation.amountCents,
        );
      }
    }
    return [...allocations].map(([billId, amountCents]) => ({ billId, amountCents }));
  }

  return oldestFirst(paymentAmountCents, openBills);
}

function oldestFirst(amount: number, bills: BillForAllocation[]): PaymentAllocation[] {
  const sorted = [...bills].sort((a, b) => {
    if (a.dueDate && b.dueDate) {
      const cmp = a.dueDate.localeCompare(b.dueDate);
      if (cmp !== 0) return cmp;
    } else if (a.dueDate) {
      return -1;
    } else if (b.dueDate) {
      return 1;
    }
    return 0;
  });

  const allocations: PaymentAllocation[] = [];
  let remaining = amount;

  for (const bill of sorted) {
    if (remaining <= 0) break;

    const outstanding = outstandingCents(bill);
    if (outstanding <= 0) continue;

    const applied = Math.min(remaining, outstanding);
    allocations.push({ billId: bill.id, amountCents: applied });
    remaining -= applied;
  }

  return allocations;
}
