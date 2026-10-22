import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { getDb } from '../../../db';
import { testimonials } from '../../../db/schema';
import { TESTIMONIAL_CONSENT_VERSION } from '../../testimonials-contract';
import { consumeTestimonialLimit, fingerprint, privateResponseHeaders, readSmallJson, RequestProblem, requireFormOrigin, testimonialError, testimonialSubmission } from '../../testimonials-server';

export async function GET() {
  try {
    // Explicit projection: never serialize the private row or a client-provided filter.
    const rows = await getDb().select({
      id: testimonials.id,
      displayName: testimonials.displayName,
      eventType: testimonials.eventType,
      message: testimonials.message,
      publishedAt: testimonials.publishedAt,
    }).from(testimonials).where(and(eq(testimonials.status, 'Published'), isNotNull(testimonials.publishedAt)))
      .orderBy(desc(testimonials.publishedAt)).limit(24);
    // No cache: unpublishing must remove a quote from subsequent public requests.
    return Response.json(rows, { headers: privateResponseHeaders });
  } catch (error) { return testimonialError(error); }
}

export async function POST(req: Request) {
  try {
    requireFormOrigin(req);
    const parsed = await readSmallJson(req);
    // Quietly discard bot submissions even if the other fields are incomplete.
    if (parsed && typeof parsed === 'object' && 'website' in parsed && typeof parsed.website === 'string' && parsed.website.trim()) {
      return Response.json({ ok: true }, { headers: privateResponseHeaders });
    }
    if (parsed && typeof parsed === 'object' && 'consentVersion' in parsed && parsed.consentVersion !== TESTIMONIAL_CONSENT_VERSION) {
      throw new RequestProblem('The publication permission has changed. Reload this form and review it before submitting.', 409);
    }
    const body = testimonialSubmission.parse(parsed);
    const db = getDb();
    // The retry token must never equal a published identifier (that would permit email guessing).
    const submissionKey = await fingerprint(body.submissionId);
    const matching = (row: typeof testimonials.$inferSelect) => row.displayName === body.displayName && row.email === body.email && row.eventType === body.eventType && row.message === body.message;
    const existing = await db.select().from(testimonials).where(eq(testimonials.submissionKey, submissionKey)).get();
    if (existing) {
      if (!matching(existing)) throw new RequestProblem('An earlier version of this submission was already saved. Contact Zach for an edit; reload only to send a separate testimonial.', 409);
      // A lost response/repeated click never creates a second testimonial.
      return Response.json({ ok: true }, { headers: privateResponseHeaders });
    }
    const retryAfter = await consumeTestimonialLimit(req, body.email);
    if (retryAfter) return Response.json({ error: 'Too many submissions. Please try again later or contact Zach directly.' }, {
      status: 429, headers: { ...privateResponseHeaders, 'Retry-After': String(retryAfter) },
    });
    const now = new Date().toISOString();
    const inserted = await db.insert(testimonials).values({
      id: crypto.randomUUID(), submissionKey, displayName: body.displayName, email: body.email,
      eventType: body.eventType, message: body.message, status: 'Pending',
      consentAt: now, consentVersion: TESTIMONIAL_CONSENT_VERSION,
      createdAt: now, updatedAt: now,
    }).onConflictDoNothing({ target: testimonials.submissionKey }).returning({ id: testimonials.id });
    if (!inserted.length) {
      const concurrent = await db.select().from(testimonials).where(eq(testimonials.submissionKey, submissionKey)).get();
      if (!concurrent || !matching(concurrent)) throw new RequestProblem('An earlier version of this submission was already saved. Contact Zach for an edit; reload only to send a separate testimonial.', 409);
    }
    return Response.json({ ok: true }, { status: 201, headers: privateResponseHeaders });
  } catch (error) { return testimonialError(error); }
}
