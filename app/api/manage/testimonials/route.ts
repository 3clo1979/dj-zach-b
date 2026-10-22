import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '../../../../db';
import { testimonials } from '../../../../db/schema';
import { getManagerUser } from '../../../cloudflare-auth';
import { isManager } from '../../../lib';
import { testimonialStatuses } from '../../../testimonials-contract';
import { privateResponseHeaders, readSmallJson, RequestProblem, requireFormOrigin, testimonialError } from '../../../testimonials-server';

async function manager() {
  // Same signed Access token and exact allowlist used by the existing Studio.
  const user = await getManagerUser();
  if (!user || !await isManager()) {
    throw new RequestProblem('Manager sign-in required. Refresh the page to sign in again.', 403);
  }
  return user;
}

export async function GET() {
  try {
    await manager();
    const rows = await getDb().select({
      id: testimonials.id, displayName: testimonials.displayName, email: testimonials.email,
      eventType: testimonials.eventType, message: testimonials.message, status: testimonials.status,
      consentAt: testimonials.consentAt, consentVersion: testimonials.consentVersion,
      createdAt: testimonials.createdAt, updatedAt: testimonials.updatedAt,
      publishedAt: testimonials.publishedAt, moderatedAt: testimonials.moderatedAt, moderatedBy: testimonials.moderatedBy,
    }).from(testimonials).orderBy(desc(testimonials.createdAt));
    return Response.json(rows, { headers: privateResponseHeaders });
  } catch (error) { return testimonialError(error); }
}

export async function POST(req: Request) {
  try {
    const user = await manager();
    requireFormOrigin(req);
    const body = z.object({
      id: z.string().uuid(), status: z.enum(testimonialStatuses), expectedUpdatedAt: z.string().datetime(),
    }).strict().parse(await readSmallJson(req, 2000));
    const db = getDb();
    const row = await db.select().from(testimonials).where(eq(testimonials.id, body.id)).get();
    if (!row) throw new RequestProblem('Testimonial not found.', 404);
    if (row.updatedAt !== body.expectedUpdatedAt) throw new RequestProblem('This testimonial changed in another session. Refresh the list before trying again.', 409);
    if (row.status === body.status) return Response.json({ ok: true }, { headers: privateResponseHeaders });
    // Do not skip review when restoring something from the archive.
    if (row.status === 'Archived' && body.status === 'Published') throw new RequestProblem('Restore this testimonial to Pending before publishing it.', 400);
    const now = new Date(Math.max(Date.now(), Date.parse(row.updatedAt) + 1)).toISOString();
    const changed = await db.update(testimonials).set({
      status: body.status, updatedAt: now, moderatedAt: now, moderatedBy: user.email.toLowerCase(),
      publishedAt: body.status === 'Published' ? now : null,
    }).where(and(eq(testimonials.id, body.id), eq(testimonials.updatedAt, body.expectedUpdatedAt)))
      .returning({ id: testimonials.id });
    if (!changed.length) throw new RequestProblem('This testimonial changed in another session. Refresh the list before trying again.', 409);
    // D1 triggers append the moderation audit in the same transaction as this update.
    return Response.json({ ok: true }, { headers: privateResponseHeaders });
  } catch (error) { return testimonialError(error); }
}
