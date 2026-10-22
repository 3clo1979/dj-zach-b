/** Shared, browser-safe manual bookkeeping contract. Never contacts a processor. */
export const referralSources = ['Google', 'Social media', 'Friend / family', 'Venue / vendor', 'Returning client', 'Other'] as const;
export const paymentMethods = ['Venmo', 'PayPal', 'Cash', 'Stripe', 'Other'] as const;
export const MAX_AMOUNT_CENTS = 99_999_999;
export type ReferralSource = typeof referralSources[number];
export type PaymentMethod = typeof paymentMethods[number];
export type FinancialRecord = {
  id: string; inquiryId: string; kind: 'payment' | 'refund'; amountCents: number;
  paidOn: string; method: PaymentMethod; createdAt: string; createdBy: string;
  voidedAt: string | null; voidedBy: string | null; voidReason: string | null;
};
export type InquiryStatusHistory = {
  id: number; inquiryId: string; fromStatus: string | null; toStatus: string;
  createdAt: string; actor: string | null;
};
/** No floating-point multiplication; null denotes invalid input, never zero. */
export function parseUsdAmount(value: string): number | null {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents <= MAX_AMOUNT_CENTS ? cents : null;
}
export function amountInput(cents: number | null | undefined): string {
  return cents == null ? '' : `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}
export function formatUsd(cents: number | null | undefined): string {
  return cents == null ? 'Not recorded' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}
export function financeTotals(records: readonly FinancialRecord[]) {
  let paymentsCents = 0, refundsCents = 0;
  for (const row of records) {
    if (row.voidedAt !== null) continue;
    if (row.kind === 'payment') paymentsCents += row.amountCents;
    else refundsCents += row.amountCents;
  }
  return { paymentsCents, refundsCents, netReceivedCents: paymentsCents - refundsCents };
}
/** A manually entered paid-on date is an Eastern calendar date, not an instant. */
export function businessToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return `${parts.find(part => part.type === 'year')!.value}-${parts.find(part => part.type === 'month')!.value}-${parts.find(part => part.type === 'day')!.value}`;
}
