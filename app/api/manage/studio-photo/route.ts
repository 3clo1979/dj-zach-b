import { env } from 'cloudflare:workers';
import { isManager } from '../../../lib';
import { RequestProblem, requireFormOrigin } from '../../../testimonials-server';
import { photoError, photoHeaders, photoVersion, readPhoto } from '../../../studio-photo-server';
import type { StudioPhotoType } from '../../../studio-photo-contract';

export const dynamic = 'force-dynamic';

async function manager() {
  // The existing guard validates the signed Access JWT and exact manager allowlist.
  if (!await isManager()) throw new RequestProblem('Manager sign-in required. Reload Studio to sign in again.', 403);
  if (!env.DB) throw new Error('D1 unavailable');
  return env.DB;
}

export async function GET() {
  try {
    const db = await manager();
    const row = await db.prepare('SELECT bytes, content_type, version FROM studio_photo WHERE id = 1').first<{ bytes: number[]; content_type: StudioPhotoType; version: string }>();
    if (!row) return new Response(null, { status: 204, headers: { ...photoHeaders, 'X-Studio-Photo-Version': 'none' } });
    return new Response(new Uint8Array(row.bytes), { headers: {
      ...photoHeaders, 'Content-Type': row.content_type,
      'Content-Disposition': 'inline; filename="studio-photo.' + (row.content_type === 'image/png' ? 'png' : 'jpg') + '"',
      'X-Studio-Photo-Version': row.version,
    } });
  } catch (error) { return photoError(error); }
}

export async function POST(req: Request) {
  try {
    const db = await manager();
    requireFormOrigin(req);
    const expected = photoVersion(req);
    const { bytes, type } = await readPhoto(req);
    const version = crypto.randomUUID(), now = new Date().toISOString();
    // Conditional writes avoid overwriting a photo changed in another Studio tab.
    const changed = expected === 'none'
      ? await db.prepare('INSERT INTO studio_photo (id, bytes, content_type, version, updated_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING RETURNING version').bind(bytes, type, version, now).first()
      : await db.prepare('UPDATE studio_photo SET bytes = ?, content_type = ?, version = ?, updated_at = ? WHERE id = 1 AND version = ? RETURNING version').bind(bytes, type, version, now, expected).first();
    if (!changed) throw new RequestProblem('The photo changed in another session. Reload it before trying again.', 409);
    return Response.json({ ok: true }, { headers: photoHeaders });
  } catch (error) { return photoError(error); }
}

export async function DELETE(req: Request) {
  try {
    const db = await manager();
    requireFormOrigin(req);
    const expected = photoVersion(req);
    if (expected === 'none') throw new RequestProblem('There is no photo selected to remove. Reload the frame.', 409);
    const changed = await db.prepare('DELETE FROM studio_photo WHERE id = 1 AND version = ? RETURNING version').bind(expected).first();
    if (!changed) throw new RequestProblem('The photo changed in another session. Reload it before trying again.', 409);
    return Response.json({ ok: true }, { headers: photoHeaders });
  } catch (error) { return photoError(error); }
}
