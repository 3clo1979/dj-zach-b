import { STUDIO_PHOTO_MAX_BYTES, type StudioPhotoType } from './studio-photo-contract';
import { RequestProblem } from './testimonials-server';

export const photoHeaders = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'none'; sandbox",
};

export function photoError(error: unknown) {
  const status = error instanceof RequestProblem ? error.status : 503;
  return Response.json({ error: error instanceof RequestProblem ? error.message : 'Studio photo is temporarily unavailable. Please try again later.' }, { status, headers: photoHeaders });
}

export function photoVersion(req: Request) {
  const value = req.headers.get('x-studio-photo-version');
  if (!value || (value !== 'none' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value))) {
    throw new RequestProblem('Reload the current photo before making a change.', 428);
  }
  return value;
}

export async function readPhoto(req: Request): Promise<{ bytes: Uint8Array<ArrayBuffer>; type: StudioPhotoType }> {
  const type = req.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (type !== 'image/jpeg' && type !== 'image/png') throw new RequestProblem('Choose an original JPEG or PNG photo.', 415);
  if (Number(req.headers.get('content-length') || 0) > STUDIO_PHOTO_MAX_BYTES) throw new RequestProblem('Choose a photo no larger than 1 MB. The original will not be resized.', 413);
  if (!req.body) throw new RequestProblem('Choose a photo first.', 400);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > STUDIO_PHOTO_MAX_BYTES) {
        await reader.cancel();
        throw new RequestProblem('Choose a photo no larger than 1 MB. The original will not be resized.', 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (!validPhotoStructure(bytes, type)) throw new RequestProblem('This file does not look like a supported JPEG or PNG photo.', 400);
  return { bytes, type };
}

// Basic signature/container and dimension checks, not re-encoding. Browser decoding
// is still the final image validation. Exact bytes (including metadata) are retained.
export function validPhotoStructure(bytes: Uint8Array, type: StudioPhotoType) {
  const dimensions = (w: number, h: number) => w > 0 && h > 0 && w <= 16000 && h <= 16000 && w * h <= 40_000_000;
  if (type === 'image/png') {
    if (bytes.length < 45 || ![137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value)) return false;
    const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 8, sawHeader = false, sawData = false;
    while (offset + 12 <= bytes.length) {
      const size = data.getUint32(offset);
      if (size > bytes.length - offset - 12) return false;
      const name = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
      if (!sawHeader) {
        if (name !== 'IHDR' || size !== 13 || !dimensions(data.getUint32(offset + 8), data.getUint32(offset + 12))) return false;
        sawHeader = true;
      } else if (name === 'IHDR') return false;
      if (name === 'IDAT') sawData = true;
      offset += size + 12;
      if (name === 'IEND') return size === 0 && sawData && offset === bytes.length;
    }
    return false;
  }
  if (bytes.length < 16 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return false;
  let offset = 2, sawFrame = false;
  while (offset + 3 < bytes.length) {
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda) {
      // Validate the scan header; entropy-coded pixels are decoded by the browser.
      const size = (bytes[offset] << 8) | bytes[offset + 1];
      const components = bytes[offset + 2];
      return sawFrame && components >= 1 && components <= 4 && size === 6 + 2 * components && offset + size < bytes.length - 2;
    }
    if (marker === 0xd8 || marker === 0xd9 || marker === 0 || (marker >= 0xd0 && marker <= 0xd7)) return false;
    const size = (bytes[offset] << 8) | bytes[offset + 1];
    if (size < 2 || offset + size > bytes.length - 2) return false;
    if ([0xc0, 0xc1, 0xc2].includes(marker)) {
      const components = bytes[offset + 7];
      if (size < 8 || components < 1 || components > 4 || size !== 8 + 3 * components || !dimensions((bytes[offset + 5] << 8) | bytes[offset + 6], (bytes[offset + 3] << 8) | bytes[offset + 4])) return false;
      sawFrame = true;
    }
    offset += size;
  }
  return false;
}
