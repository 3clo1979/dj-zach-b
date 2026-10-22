import { z } from 'zod';
import { and, or, exists, notExists, eq, desc, asc, sql, lt, isNull } from 'drizzle-orm';
import { getDb } from '../../../db';
import { inquiries, events, financialRecords, inquiryStatusHistory, inquiryAmountHistory, financeRateLimits } from '../../../db/schema';
import { isManager, sameOrigin, validDate, statuses } from '../../lib';
import { getManagerUser } from '../../cloudflare-auth';
import { parseUsdAmount, paymentMethods, businessToday } from '../../booking-finance-contract';
import { FinanceRequestProblem, readManageJson } from '../../booking-finance-server';
import { eventDetailLimits, inquiryServicePlan, contactLine } from '../../event-details-contract';

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: privateHeaders });
const oneLine = (max: number) => z.string().max(max).refine(value => !/[\r\n\0]/.test(value));
const detailFields = {
  servicePlan: z.string().max(eventDetailLimits.servicePlan),
  contactName: oneLine(eventDetailLimits.contactName),
  contactEmail: z.string().trim().max(eventDetailLimits.contactEmail).refine(value => !value || z.string().email().safeParse(value).success),
  contactPhone: oneLine(eventDetailLimits.contactPhone),
  // Do not trim or reconstruct notes: existing wording and line breaks matter.
  notes: z.string().max(eventDetailLimits.notes),
};
const revision = z.union([z.literal('legacy'), z.string().uuid()]);
const updateDetails = z.object({
  action: z.literal('update-event-details'),
  id: z.string().min(1).max(100),
  revision,
  ...detailFields,
}).strict();
const amount = z.string().refine(value => parseUsdAmount(value) !== null, 'Use a USD amount with at most two decimal places.').transform(value => parseUsdAmount(value)!);
const inquiryId = z.string().min(1).max(100);
const actionSchema = z.discriminatedUnion('action', [
  updateDetails,
  z.object({ action: z.literal('status'), id: inquiryId, status: z.string().max(40), inquiryRevision: revision, bookingRevision: revision.optional(), amount: amount.nullable().optional() }).strict(),
  z.object({ action: z.literal('amounts'), id: inquiryId, inquiryRevision: revision, quotedAmount: amount.nullable(), bookedAmount: amount.nullable() }).strict(),
  z.object({ action: z.literal('record-payment'), id: inquiryId, inquiryRevision: revision, recordId: z.string().uuid(), kind: z.enum(['payment', 'refund']), amount: amount.refine(value => value > 0), paidOn: z.string().refine(value => validDate(value) && value >= '1900-01-01' && value <= businessToday()), method: z.enum(paymentMethods) }).strict(),
  z.object({ action: z.literal('void-payment'), id: inquiryId, inquiryRevision: revision, recordId: z.string().uuid(), reason: oneLine(300).transform(value => value.trim()).refine(value => value.length > 0) }).strict(),
  z.object({ action: z.literal('delete-event'), id: z.string().min(1).max(100), revision }).strict(),
  z.object({
    action: z.literal('event'),
    title: z.string().max(200).default(''), date: z.string().default(''),
    venue: z.string().max(300).default(''), type: z.string().max(40).default(''),
    start: z.string().max(5).default(''), end: z.string().max(5).default(''),
    facebook: z.string().max(1000).default(''), isPublic: z.boolean().default(false),
    servicePlan: detailFields.servicePlan.default(''), contactName: detailFields.contactName.default(''),
    contactEmail: detailFields.contactEmail.default(''), contactPhone: detailFields.contactPhone.default(''),
    notes: detailFields.notes.default(''),
  }),
]);

export async function GET() {
  if (!await isManager()) return reply({ error: 'Manager sign-in required.' }, 403);
  try {
    const db = getDb();
    // A single read transaction keeps revisions, amounts and ledger totals coherent.
    const [inquiryRows, eventRows, records, history, amounts] = await db.batch([
      db.select().from(inquiries).orderBy(desc(inquiries.createdAt)),
      db.select().from(events).orderBy(asc(events.date)),
      db.select().from(financialRecords).orderBy(desc(financialRecords.createdAt), desc(financialRecords.id)),
      db.select().from(inquiryStatusHistory).orderBy(asc(inquiryStatusHistory.id)),
      db.select().from(inquiryAmountHistory).orderBy(asc(inquiryAmountHistory.id)),
    ]);
    return reply({ inquiries: inquiryRows, events: eventRows, financialRecords: records, statusHistory: history, amountHistory: amounts });
  } catch {
    return reply({ error: 'Studio records are temporarily unavailable. Refresh your desk before making changes.' }, 503);
  }
}

export async function POST(req: Request) {
  // Require the same origin explicitly for private browser mutations (including a missing Origin).
  if (!await isManager() || !sameOrigin(req) || !req.headers.get('origin')) return reply({ error: 'Not authorized.' }, 403);
  try {
    const b = actionSchema.parse(await readManageJson(req)), db = getDb();
    const user = await getManagerUser();
    if (!user) return reply({ error: 'Not authorized.' }, 403);
    const actor = user.email.toLowerCase(), now = new Date().toISOString();
    if (['status', 'amounts', 'record-payment', 'void-payment'].includes(b.action)) {
      // Persistent, atomic bound shared by Worker instances, only after JWT validation.
      const minute = Math.floor(Date.now() / 60000);
      const [limit] = await db.insert(financeRateLimits).values({ key: actor + ':' + minute, count: 1, expiresAt: (minute + 2) * 60000 })
        .onConflictDoUpdate({ target: financeRateLimits.key, set: { count: sql`min(${financeRateLimits.count} + 1, 61)` } }).returning({ count: financeRateLimits.count });
      if (limit.count > 60) return Response.json({ error: 'Too many bookkeeping changes. Wait one minute, then refresh your desk.' }, { status: 429, headers: { ...privateHeaders, 'Retry-After': '60' } });
      await db.delete(financeRateLimits).where(lt(financeRateLimits.expiresAt, Date.now()));
    }
    if (b.action === 'amounts' || b.action === 'record-payment' || b.action === 'void-payment') {
      const q = await db.select().from(inquiries).where(eq(inquiries.id, b.id)).get();
      if (!q) return reply({ error: 'Inquiry not found.' }, 404);
      const stale = () => reply({ error: 'This inquiry or its financial records changed. Refresh your desk and review before saving again.' }, 409);
      const nextRevision = crypto.randomUUID();
      const ownsVersion = and(eq(inquiries.id, q.id), eq(inquiries.revision, b.inquiryRevision));
      const netFunds = sql<number>`(SELECT coalesce(sum(CASE WHEN kind = 'payment' THEN amount_cents ELSE -amount_cents END), 0) FROM financial_records WHERE inquiry_id = ${q.id} AND voided_at IS NULL)`;
      if (b.action === 'amounts') {
        const [changed] = await db.update(inquiries).set({ quotedAmountCents: b.quotedAmount, bookedAmountCents: b.bookedAmount, revision: nextRevision, changedAt: now, changedBy: actor }).where(ownsVersion).returning({ id: inquiries.id });
        return changed ? reply({ ok: true, revision: nextRevision }) : stale();
      }
      const old = await db.select().from(financialRecords).where(eq(financialRecords.id, b.recordId)).get();
      if (b.action === 'record-payment') {
        if (old) {
          // A lost response may be retried, including after the original was voided.
          // Exact original identity is required; a reused key never rewrites a record.
          const same = old.inquiryId === b.id && old.kind === b.kind && old.amountCents === b.amount && old.paidOn === b.paidOn && old.method === b.method;
          return same ? reply({ ok: true, duplicate: true }) : reply({ error: 'This payment reference already belongs to a different entry. Refresh and review the ledger.' }, 409);
        }
        if (q.revision !== b.inquiryRevision) return stale();
        const [changed] = await db.batch([
          db.update(inquiries).set({ revision: nextRevision, changedAt: now, changedBy: actor })
            .where(and(ownsVersion, b.kind === 'refund' ? sql`${netFunds} >= ${b.amount}` : undefined)).returning({ id: inquiries.id }),
          db.insert(financialRecords).select(db.select({
            id: sql<string>`${b.recordId}`.as('id'), inquiryId: inquiries.id, kind: sql<'payment' | 'refund'>`${b.kind}`.as('kind'),
            amountCents: sql<number>`${b.amount}`.as('amountCents'), paidOn: sql<string>`${b.paidOn}`.as('paidOn'), method: sql<typeof b.method>`${b.method}`.as('method'),
            createdAt: sql<string>`${now}`.as('createdAt'), createdBy: sql<string>`${actor}`.as('createdBy'),
            voidedAt: sql<null>`NULL`.as('voidedAt'), voidedBy: sql<null>`NULL`.as('voidedBy'), voidReason: sql<null>`NULL`.as('voidReason'),
          }).from(inquiries).where(and(eq(inquiries.id, q.id), eq(inquiries.revision, nextRevision)))),
        ]);
        if (!changed.length) {
          const repeated = await db.select().from(financialRecords).where(eq(financialRecords.id, b.recordId)).get();
          if (repeated && repeated.inquiryId === b.id && repeated.kind === b.kind && repeated.amountCents === b.amount && repeated.paidOn === b.paidOn && repeated.method === b.method) return reply({ ok: true, duplicate: true });
          return reply({ error: 'This inquiry changed, or the refund exceeds recorded funds. Refresh and review the ledger.' }, 409);
        }
        return reply({ ok: true, revision: nextRevision });
      }
      if (!old || old.inquiryId !== b.id) return reply({ error: 'Financial record not found.' }, 404);
      if (old.voidedAt !== null) return old.voidReason === b.reason ? reply({ ok: true, duplicate: true }) : reply({ error: 'This entry has already been voided. Its audit reason cannot be overwritten.' }, 409);
      if (q.revision !== b.inquiryRevision) return stale();
      const currentEntry = db.select({ id: financialRecords.id }).from(financialRecords).where(and(eq(financialRecords.id, old.id), isNull(financialRecords.voidedAt)));
      const changedInquiry = db.select({ id: inquiries.id }).from(inquiries).where(and(eq(inquiries.id, q.id), eq(inquiries.revision, nextRevision)));
      const [changed] = await db.batch([
        db.update(inquiries).set({ revision: nextRevision, changedAt: now, changedBy: actor })
          .where(and(ownsVersion, exists(currentEntry), old.kind === 'payment' ? sql`${netFunds} >= ${old.amountCents}` : undefined)).returning({ id: inquiries.id }),
        db.update(financialRecords).set({ voidedAt: now, voidedBy: actor, voidReason: b.reason })
          .where(and(eq(financialRecords.id, old.id), isNull(financialRecords.voidedAt), exists(changedInquiry))),
      ]);
      if (!changed.length) {
        const repeated = await db.select().from(financialRecords).where(eq(financialRecords.id, old.id)).get();
        if (repeated?.voidedAt && repeated.voidReason === b.reason) return reply({ ok: true, duplicate: true });
        return reply({ error: 'This inquiry changed, or voiding this payment would leave refunds without recorded funds. Review the ledger; correct any mistaken refunds first.' }, 409);
      }
      return reply({ ok: true, revision: nextRevision });
    }
    if (b.action === 'update-event-details') {
      // One atomic conditional UPDATE, not read-then-write. A stale editor can
      // never overwrite a newer saved plan, even if requests arrive together.
      const [saved] = await db.update(events).set({
        servicePlan: b.servicePlan, contactName: b.contactName,
        contactEmail: b.contactEmail, contactPhone: b.contactPhone,
        notes: b.notes, revision: crypto.randomUUID(),
      }).where(and(eq(events.id, b.id), eq(events.revision, b.revision)))
        .returning({ revision: events.revision });
      if (saved) return reply({ ok: true, revision: saved.revision });
      const existing = await db.select({ id: events.id }).from(events).where(eq(events.id, b.id)).get();
      return existing
        ? reply({ error: 'This event changed since you opened it. Reload its details and review your changes before saving again.' }, 409)
        : reply({ error: 'This calendar entry no longer exists. Refresh the calendar before continuing.' }, 404);
    }
    if (b.action === 'status') {
      if (!statuses.includes(b.status) || (b.amount !== undefined && !['Quote sent', 'Booked'].includes(b.status))) return reply({ error: 'Invalid status or amount.' }, 400);
      const q = await db.select().from(inquiries).where(eq(inquiries.id, b.id)).get();
      if (!q) return reply({ error: 'Inquiry not found.' }, 404);
      if (q.revision !== b.inquiryRevision) return reply({ error: 'This inquiry changed. Refresh the desk before changing its status.' }, 409);
      const linked = 'booking-' + q.id, nextRevision = crypto.randomUUID();
      const values = { status: b.status, revision: nextRevision, changedAt: now, changedBy: actor,
        ...(b.amount !== undefined && b.status === 'Quote sent' ? { quotedAmountCents: b.amount } : {}),
        ...(b.amount !== undefined && b.status === 'Booked' ? { bookedAmountCents: b.amount } : {}),
      };
      const ownsVersion = and(eq(inquiries.id, q.id), eq(inquiries.revision, b.inquiryRevision));
      if (b.status === 'Booked') {
        const clashes = await db.select().from(events).where(eq(events.date, q.date));
        if (clashes.some(event => event.id !== linked)) return reply({ error: 'This date already has a booking, appearance, or block. Review the schedule before confirming.' }, 409);
        const [changed] = await db.batch([
          db.update(inquiries).set(values).where(ownsVersion).returning({ id: inquiries.id }),
          // The insert depends on the successful CAS in the same transaction.
          // A stale request cannot recreate an entry after a later cancellation.
          db.insert(events).select(db.select({
            id: sql<string>`${linked}`.as('id'), title: sql<string>`${q.name + ' · ' + q.eventType}`.as('title'), date: inquiries.date,
            start: sql<string>`''`.as('start'), end: sql<string>`''`.as('end'), venue: inquiries.venue, type: sql<string>`'Private booking'`.as('type'),
            isPublic: sql<boolean>`0`.as('isPublic'), facebook: sql<string>`''`.as('facebook'), notes: inquiries.message,
            servicePlan: sql<string>`${inquiryServicePlan(q.services)}`.as('servicePlan'), contactName: sql<string>`${contactLine(q.name)}`.as('contactName'),
            contactEmail: inquiries.email, contactPhone: sql<string>`${contactLine(q.phone)}`.as('contactPhone'), revision: sql<string>`${crypto.randomUUID()}`.as('revision'),
          }).from(inquiries).where(and(eq(inquiries.id, q.id), eq(inquiries.revision, nextRevision))))
            .onConflictDoNothing({ target: events.id }),
        ]);
        if (!changed.length) return reply({ error: 'This inquiry changed before booking. Refresh your desk.' }, 409);
      } else {
        const current = await db.select({ revision: events.revision }).from(events).where(eq(events.id, linked)).get();
        if (current && current.revision !== b.bookingRevision) return reply({ error: 'This booking has saved calendar details. Refresh the desk and confirm removing the current entry before changing its status.' }, 409);
        const linkedEvent = db.select({ id: events.id }).from(events).where(eq(events.id, linked));
        const acknowledgedEvent = db.select({ id: events.id }).from(events).where(and(eq(events.id, linked), eq(events.revision, b.bookingRevision ?? '')));
        const canRelease = b.bookingRevision ? or(notExists(linkedEvent), exists(acknowledgedEvent)) : notExists(linkedEvent);
        const changedInquiry = db.select({ id: inquiries.id }).from(inquiries).where(and(eq(inquiries.id, q.id), eq(inquiries.revision, nextRevision)));
        const [changed] = await db.batch([
          db.update(inquiries).set(values).where(and(ownsVersion, canRelease)).returning({ id: inquiries.id }),
          db.delete(events).where(and(eq(events.id, linked), eq(events.revision, b.bookingRevision ?? ''), exists(changedInquiry))).returning({ id: events.id }),
        ]);
        if (!changed.length) return reply({ error: 'This booking changed before its entry could be removed. Refresh the desk and review the current details.' }, 409);
      }
      return reply({ ok: true, revision: nextRevision });
    }
    if (b.action === 'event') {
      const title = b.title.trim(), date = b.date, venue = b.venue.trim(), type = b.type;
      const facebook = b.facebook.trim();
      if (!title || !validDate(date) || !['Public appearance', 'Private booking', 'Blocked date'].includes(type)
        || (b.start && !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.start))
        || (b.end && !/^([01]\d|2[0-3]):[0-5]\d$/.test(b.end))) return reply({ error: 'Please check the event details.' }, 400);
      if (facebook) {
        try {
          const url = new URL(facebook);
          if (url.protocol !== 'https:' || !(url.hostname === 'facebook.com' || url.hostname.endsWith('.facebook.com'))) throw new Error();
        } catch { return reply({ error: 'Use a valid HTTPS Facebook event link.' }, 400); }
      }
      const clash = await db.select().from(events).where(eq(events.date, date)).get();
      if (clash) return reply({ error: 'There is already an entry on this date. Review it before adding another.' }, 409);
      await db.insert(events).values({
        id: crypto.randomUUID(), title, date, start: b.start, end: b.end, venue, type,
        isPublic: type === 'Public appearance' && b.isPublic,
        facebook: type === 'Public appearance' ? facebook : '',
        notes: b.notes, servicePlan: b.servicePlan, contactName: b.contactName,
        contactEmail: b.contactEmail, contactPhone: b.contactPhone, revision: crypto.randomUUID(),
      });
      return reply({ ok: true });
    }
    if (b.id.startsWith('booking-')) {
      const linked = await db.select({ id: events.id }).from(events).where(eq(events.id, b.id)).get();
      return linked ? reply({ error: 'Change the inquiry status to cancel this booking.' }, 400) : reply({ error: 'Entry not found.' }, 404);
    }
    const [removed] = await db.delete(events).where(and(eq(events.id, b.id), eq(events.revision, b.revision))).returning({ id: events.id });
    if (removed) return reply({ ok: true });
    const existing = await db.select({ id: events.id }).from(events).where(eq(events.id, b.id)).get();
    return existing
      ? reply({ error: 'This entry changed before it could be removed. Refresh the calendar and review the current details.' }, 409)
      : reply({ error: 'Entry not found.' }, 404);
  } catch (error) {
    if ((String(error) + ' ' + String((error as { cause?: unknown })?.cause)).includes('UNIQUE constraint failed: events.date')) return reply({ error: 'This date was just booked. Refresh the schedule and choose another date.' }, 409);
    if ((String(error) + ' ' + String((error as { cause?: unknown })?.cause)).includes('UNIQUE constraint failed: financial_records.id')) return reply({ error: 'This payment reference was just used. Refresh and review the ledger before retrying.' }, 409);
    if (error instanceof FinanceRequestProblem) return reply({ error: error.message }, error.status);
    if (error instanceof z.ZodError || error instanceof SyntaxError) return reply({ error: 'Please check your details.' }, 400);
    return reply({ error: 'Could not save. Please try again.' }, 500);
  }
}
