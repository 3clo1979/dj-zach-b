import type { Entry, Inquiry } from './studio-data';
import { MAX_AMOUNT_CENTS, referralSources, type FinancialRecord } from '../booking-finance-contract';

export const BUSINESS_TIME_ZONE = 'America/New_York';

// Only the non-identifying ledger fields needed by this aggregate projection.
// The full authenticated response may contain audit actors/reasons; never copy
// those into the Snapshot result or chart labels.
export type SnapshotFinancialRecord = Pick<FinancialRecord, 'id' | 'inquiryId' | 'kind' | 'amountCents' | 'paidOn' | 'voidedAt'>;
export type RecordedTotals = { paymentsCents: number; refundsCents: number; netCents: number; paymentCount: number; refundCount: number };
export type InquiryCohort = { inquiries: number; booked: number; conversionRate: number | null };
export type BusinessSnapshot = {
  windows: { today: string; currentStart: string; currentEnd: string; priorStart: string; priorEnd: string };
  current: InquiryCohort;
  prior: InquiryCohort;
  trend: { month: string; inquiries: number; partial: boolean }[];
  followUps: { newInquiries: number; agedSevenDays: number; oldestAgeDays: number | null; unknownAgeCount: number };
  upcomingBookings: { total: number; linked: number; manual: number };
  bookedValue: { total: number; known: number; unknown: number; amountCents: number | null; invalidAmountCount: number };
  recorded: {
    current: RecordedTotals; prior: RecordedTotals; allTime: RecordedTotals;
    excludedTestCount: number; voidedCount: number; orphanCount: number;
    invalidCount: number; futureCount: number; duplicateCount: number;
  };
  discovery: { sources: { source: string; count: number }[]; known: number; unknown: number; total: number };
  excludedInquiryCount: number;
  excludedEventCount: number;
  invalidCreatedAtCount: number;
  futureCreatedAtCount: number;
  invalidEventDateCount: number;
};

const businessDateFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});
function businessDay(value: Date) {
  const parts = businessDateFormatter.formatToParts(value);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}
function validCalendarDay(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function shiftDay(value: string, amount: number) {
  const date = new Date(value + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
function shiftMonth(value: string, amount: number) {
  const date = new Date(value.slice(0, 7) + '-01T12:00:00Z');
  date.setUTCMonth(date.getUTCMonth() + amount);
  return date.toISOString().slice(0, 7);
}

// createdAt is an instant, unlike an event's calendar date. Reject ambiguous
// local/date-only values and rollover dates rather than silently assigning them
// a browser time zone or normalizing an impossible day into a different month.
function createdInstant(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) || !validCalendarDay(value.slice(0, 10))) return null;
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) ? instant : null;
}

// These are explicit training markers, not the substring "test". A legitimate
// name such as Contest Events or Testa must never disappear from reporting.
function testLabel(value: string | null) {
  const label = (value ?? '').trim();
  return /^TEST ONLY \d{8}-[ITE]\d+(?:\s|$)/i.test(label) || /^TEST Deployment Check$/i.test(label);
}
function testEmail(value: string | null) {
  return /^[^@\s]+@example\.test$/i.test((value ?? '').trim());
}
function testInquiry(inquiry: Inquiry) { return testLabel(inquiry.name) || testEmail(inquiry.email); }
function testEvent(event: Entry, testInquiryIds: ReadonlySet<string>) {
  return testLabel(event.title) || testLabel(event.contactName) || testEmail(event.contactEmail)
    || (event.id.startsWith('booking-') && testInquiryIds.has(event.id.slice('booking-'.length)));
}
function cohort(rows: { inquiry: Inquiry; day: string }[], start: string, end: string): InquiryCohort {
  const included = rows.filter(row => row.day >= start && row.day <= end);
  const booked = included.filter(row => row.inquiry.status === 'Booked').length;
  return { inquiries: included.length, booked, conversionRate: included.length ? booked / included.length * 100 : null };
}

/**
 * Read-only, aggregate-only projection of the existing authenticated Studio load.
 * Periods use 30 complete New York calendar days, not 30 * 24 elapsed hours.
 * Booked means the CURRENT status of inquiries CREATED in the stated cohort;
 * confirmation dates are not inferred from status or migration dates. Financial
 * periods instead use the manually entered payment/refund calendar date.
 */
export function businessSnapshot(inquiries: readonly Inquiry[], events: readonly Entry[], now: Date, financialRecords: readonly SnapshotFinancialRecord[] = []): BusinessSnapshot {
  if (!Number.isFinite(now.getTime())) throw new RangeError('Snapshot requires a valid refresh time.');
  const today = businessDay(now);
  const windows = { today, currentStart: shiftDay(today, -30), currentEnd: shiftDay(today, -1), priorStart: shiftDay(today, -60), priorEnd: shiftDay(today, -31) };
  const testInquiryIds = new Set(inquiries.filter(testInquiry).map(inquiry => inquiry.id));
  const realInquiries = inquiries.filter(inquiry => !testInquiry(inquiry));
  const realEvents = events.filter(event => !testEvent(event, testInquiryIds));
  const trend = Array.from({ length: 6 }, (_, index) => ({ month: shiftMonth(today, index - 5), inquiries: 0, partial: index === 5 }));
  const followUps: BusinessSnapshot['followUps'] = { newInquiries: 0, agedSevenDays: 0, oldestAgeDays: null, unknownAgeCount: 0 };
  let invalidCreatedAtCount = 0, futureCreatedAtCount = 0;
  const dated: { inquiry: Inquiry; day: string }[] = [];
  for (const inquiry of realInquiries) {
    const instant = createdInstant(inquiry.createdAt);
    const future = instant !== null && instant.getTime() > now.getTime();
    if (!instant) invalidCreatedAtCount++;
    else if (future) futureCreatedAtCount++;
    const day = instant && !future ? businessDay(instant) : null;
    if (day) {
      dated.push({ inquiry, day });
      const month = trend.find(item => item.month === day.slice(0, 7));
      if (month) month.inquiries++;
    }
    if (inquiry.status === 'New') {
      followUps.newInquiries++;
      if (!day) followUps.unknownAgeCount++;
      else {
        // UTC is used only to subtract calendar labels: this deliberately counts
        // local date boundaries, including 23/25-hour DST days, not elapsed time.
        const age = (new Date(today + 'T12:00:00Z').getTime() - new Date(day + 'T12:00:00Z').getTime()) / 86_400_000;
        if (age >= 7) followUps.agedSevenDays++;
        followUps.oldestAgeDays = Math.max(followUps.oldestAgeDays ?? 0, age);
      }
    }
  }
  let invalidEventDateCount = 0;
  const upcomingBookings = { total: 0, linked: 0, manual: 0 };
  for (const event of realEvents) {
    if (!validCalendarDay(event.date)) { invalidEventDateCount++; continue; }
    if (event.type !== 'Private booking' || event.date < today) continue;
    upcomingBookings.total++;
    if (/^booking-.+/.test(event.id)) upcomingBookings.linked++;
    else upcomingBookings.manual++;
  }
  const bookedValue: BusinessSnapshot['bookedValue'] = { total: 0, known: 0, unknown: 0, amountCents: null, invalidAmountCount: 0 };
  for (const inquiry of realInquiries) {
    if (inquiry.status !== 'Booked') continue;
    bookedValue.total++;
    const amount = inquiry.bookedAmountCents;
    if (amount === null || amount === undefined) bookedValue.unknown++;
    else if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_AMOUNT_CENTS) { bookedValue.unknown++; bookedValue.invalidAmountCount++; }
    else { bookedValue.known++; bookedValue.amountCents = (bookedValue.amountCents ?? 0) + amount; }
  }

  const emptyTotals = (): RecordedTotals => ({ paymentsCents: 0, refundsCents: 0, netCents: 0, paymentCount: 0, refundCount: 0 });
  const recorded: BusinessSnapshot['recorded'] = {
    current: emptyTotals(), prior: emptyTotals(), allTime: emptyTotals(),
    excludedTestCount: 0, voidedCount: 0, orphanCount: 0, invalidCount: 0, futureCount: 0, duplicateCount: 0,
  };
  const inquiryIds = new Set(realInquiries.map(inquiry => inquiry.id));
  const ledgerIds = new Set<string>();
  const addRecord = (totals: RecordedTotals, record: SnapshotFinancialRecord) => {
    if (record.kind === 'payment') { totals.paymentsCents += record.amountCents; totals.paymentCount++; }
    else { totals.refundsCents += record.amountCents; totals.refundCount++; }
    totals.netCents = totals.paymentsCents - totals.refundsCents;
  };
  for (const record of financialRecords) {
    if (testInquiryIds.has(record.inquiryId)) { recorded.excludedTestCount++; continue; }
    if (!inquiryIds.has(record.inquiryId)) { recorded.orphanCount++; continue; }
    if (!record.id || ledgerIds.has(record.id)) { recorded.duplicateCount++; continue; }
    ledgerIds.add(record.id);
    if (record.voidedAt != null) { recorded.voidedCount++; continue; }
    if ((record.kind !== 'payment' && record.kind !== 'refund') || !Number.isSafeInteger(record.amountCents) || record.amountCents <= 0 || record.amountCents > MAX_AMOUNT_CENTS || !validCalendarDay(record.paidOn)) { recorded.invalidCount++; continue; }
    if (record.paidOn > today) { recorded.futureCount++; continue; }
    // Canceled/rebooked inquiries keep the same ledger. Current status, received
    // timestamp and event deletion do not erase or re-date recorded money.
    addRecord(recorded.allTime, record);
    if (record.paidOn >= windows.currentStart && record.paidOn <= windows.currentEnd) addRecord(recorded.current, record);
    if (record.paidOn >= windows.priorStart && record.paidOn <= windows.priorEnd) addRecord(recorded.prior, record);
  }
  const sources = referralSources.map(source => ({ source, count: 0 }));
  const discovery: BusinessSnapshot['discovery'] = { sources, known: 0, unknown: 0, total: 0 };
  for (const row of dated) {
    if (row.day < windows.currentStart || row.day > windows.currentEnd) continue;
    discovery.total++;
    const source = sources.find(item => item.source === row.inquiry.referralSource);
    if (source) { source.count++; discovery.known++; } else discovery.unknown++;
  }
  return {
    windows,
    current: cohort(dated, windows.currentStart, windows.currentEnd),
    prior: cohort(dated, windows.priorStart, windows.priorEnd),
    trend, followUps, upcomingBookings, bookedValue, recorded, discovery,
    excludedInquiryCount: inquiries.length - realInquiries.length,
    excludedEventCount: events.length - realEvents.length,
    invalidCreatedAtCount, futureCreatedAtCount, invalidEventDateCount,
  };
}
