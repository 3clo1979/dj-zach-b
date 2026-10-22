import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { TESTIMONIAL_CONSENT_VERSION, testimonialEventTypes } from './testimonials-contract';

export const testimonialSubmission = z.object({
  submissionId: z.string().uuid(),
  displayName: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(200).transform(s => s.toLowerCase()),
  eventType: z.enum(testimonialEventTypes),
  message: z.string().trim().min(10).max(2000),
  consent: z.literal(true),
  consentVersion: z.literal(TESTIMONIAL_CONSENT_VERSION),
  website: z.string().max(300).optional().default(''),
}).strict();

export class RequestProblem extends Error {
  constructor(message: string, public status: number) { super(message); }
}

// Check actual streamed bytes, not just a caller-controlled Content-Length.
export async function readSmallJson(req: Request, maxBytes = 16000): Promise<unknown> {
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new RequestProblem('Please submit the website form as JSON.', 415);
  }
  if (Number(req.headers.get('content-length') || 0) > maxBytes) {
    throw new RequestProblem('Your submission is too long.', 413);
  }
  if (!req.body) throw new RequestProblem('Please complete the form.', 400);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new RequestProblem('Your submission is too long.', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new RequestProblem('Please check the form and try again.', 400); }
}

export function requireFormOrigin(req: Request) {
  // Browser JSON POSTs must come from this exact origin. Missing Origin also fails closed.
  if (req.headers.get('origin') !== new URL(req.url).origin) {
    throw new RequestProblem('Please submit from this website.', 403);
  }
}

export async function fingerprint(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

// Persistent, atomic counters work across Worker instances; no new API key required.
// This is a bounded abuse control, NOT proof of identity or a CAPTCHA substitute.
export async function consumeTestimonialLimit(req: Request, email: string, now = Date.now()) {
  if (!env.DB) throw new Error('D1 unavailable');
  const hour = Math.floor(now / 3600000);
  const day = Math.floor(now / 86400000);
  const increment = async (key: string, limit: number, expiresAt: number) => {
    const row = await env.DB!.prepare(`INSERT INTO testimonial_rate_limits (key, count, expires_at)
      VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = MIN(count + 1, ?)
      RETURNING count`).bind(key, expiresAt, limit + 1).first<{ count: number }>();
    if (!row) throw new Error('Rate counter unavailable');
    return row.count <= limit;
  };
  // The global bound prevents unbounded per-IP/email rows during an attack.
  if (!await increment('global:' + hour, 120, (hour + 2) * 3600000)) return 3600;
  await env.DB.prepare('DELETE FROM testimonial_rate_limits WHERE expires_at < ?').bind(now).run();
  // Cloudflare sets this header at the edge. Never use X-Forwarded-For here.
  // No header (e.g. local testing) shares one bucket rather than bypassing limits.
  const network = req.headers.get('cf-connecting-ip')?.slice(0, 100) || 'unknown-network';
  const networkKey = await fingerprint(day + ':' + network);
  if (!await increment('network:' + hour + ':' + networkKey, 10, (hour + 2) * 3600000)) return 3600;
  const emailKey = await fingerprint(day + ':' + email);
  if (!await increment('email:' + day + ':' + emailKey, 3, (day + 2) * 86400000)) return 86400;
  return 0;
}

export const privateResponseHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export function testimonialError(error: unknown) {
  const status = error instanceof RequestProblem ? error.status : error instanceof z.ZodError ? 400 : 503;
  const message = error instanceof RequestProblem ? error.message : error instanceof z.ZodError
    ? 'Please check your name, email, event type, message, and publication permission.'
    : 'Testimonials are temporarily unavailable. Please try again later.';
  return Response.json({ error: message }, { status, headers: privateResponseHeaders });
}
