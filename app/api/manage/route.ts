import { z } from 'zod';
import { and, or, exists, notExists, eq, desc, asc } from 'drizzle-orm';
import { getDb } from '../../../db';
import { inquiries, events } from '../../../db/schema';
import { isManager, sameOrigin, validDate, statuses } from '../../lib';
import { eventDetailLimits, inquiryServicePlan, contactLine } from '../../event-details-contract';

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' };
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
const actionSchema = z.discriminatedUnion('action', [
  updateDetails,
  z.object({ action: z.literal('status'), id: z.string().max(100).default(''), status: z.string().max(40).default(''), bookingRevision: revision.optional() }),
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
  const db = getDb();
  return reply({
    inquiries: await db.select().from(inquiries).orderBy(desc(inquiries.createdAt)),
    events: await db.select().from(events).orderBy(asc(events.date)),
  });
}

export async function POST(req: Request) {
  if (!await isManager() || !sameOrigin(req)) return reply({ error: 'Not authorized.' }, 403);
  try {
    const b = actionSchema.parse(await req.json()), db = getDb();
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
      if (!statuses.includes(b.status)) return reply({ error: 'Invalid status.' }, 400);
      const q = await db.select().from(inquiries).where(eq(inquiries.id, b.id)).get();
      if (!q) return reply({ error: 'Inquiry not found.' }, 404);
      const linked = 'booking-' + q.id;
      if (b.status === 'Booked') {
        const clashes = await db.select().from(events).where(eq(events.date, q.date));
        if (clashes.some(event => event.id !== linked)) return reply({ error: 'This date already has a booking, appearance, or block. Review the schedule before confirming.' }, 409);
        await db.batch([
          db.update(inquiries).set({ status: b.status }).where(eq(inquiries.id, q.id)),
          db.insert(events).values({
            id: linked, title: q.name + ' · ' + q.eventType, date: q.date,
            start: '', end: '', venue: q.venue, type: 'Private booking', isPublic: false, facebook: '',
            servicePlan: inquiryServicePlan(q.services), notes: q.message,
            contactName: contactLine(q.name), contactEmail: q.email, contactPhone: contactLine(q.phone), revision: crypto.randomUUID(),
          // Prefill only a newly created event; repeated Booked never replaces edits.
          }).onConflictDoNothing({ target: events.id }),
        ]);
      } else {
        // Existing lifecycle: leaving Booked releases the linked calendar entry.
        // The UI must acknowledge the exact event whose private details it removes.
        const current = await db.select({ revision: events.revision }).from(events).where(eq(events.id, linked)).get();
        if (current && current.revision !== b.bookingRevision) return reply({ error: 'This booking has saved calendar details. Refresh the desk and confirm removing the current entry before changing its status.' }, 409);
        const linkedEvent = db.select({ id: events.id }).from(events).where(eq(events.id, linked));
        const acknowledgedEvent = db.select({ id: events.id }).from(events).where(and(eq(events.id, linked), eq(events.revision, b.bookingRevision ?? '')));
        const canRelease = b.bookingRevision ? or(notExists(linkedEvent), exists(acknowledgedEvent)) : notExists(linkedEvent);
        // Both operations share one D1 transaction. Re-check the event version in
        // the status UPDATE, not just in DELETE, so a racing edit/rebooking cannot
        // leave a Canceled inquiry with a still-live private calendar entry.
        const [changed] = await db.batch([
          db.update(inquiries).set({ status: b.status }).where(and(eq(inquiries.id, q.id), canRelease)).returning({ id: inquiries.id }),
          db.delete(events).where(and(eq(events.id, linked), eq(events.revision, b.bookingRevision ?? ''))).returning({ id: events.id }),
        ]);
        if (!changed.length) return reply({ error: 'This booking changed before its entry could be removed. Refresh the desk and review the current details.' }, 409);
      }
      return reply({ ok: true });
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
    if (error instanceof z.ZodError || error instanceof SyntaxError) return reply({ error: 'Please check your details.' }, 400);
    return reply({ error: 'Could not save. Please try again.' }, 500);
  }
}
