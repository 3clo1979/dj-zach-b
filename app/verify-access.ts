// Verify identity at the origin as well as at the Access edge. Never trust
// oai-authenticated-* or cf-access-authenticated-user-email headers directly.
type AccessUser = { userId: string; email: string };
type Jwk = JsonWebKey & { kid?: string };
let cached: { issuer: string; keys: Jwk[]; expires: number } | undefined;
const allowedEmails = new Set(['3clo1979@gmail.com', 'djzachb@yahoo.com']);
function decode(part: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error('Invalid token');
  const value = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(value, c => c.charCodeAt(0));
}
export type AccessResult = { user: AccessUser | null; code: string };
export async function verifyAccessToken(token: string | null, team: string | undefined, audience: string | undefined): Promise<AccessUser | null> {
  return (await inspectAccessToken(token, team, audience)).user;
}
export async function inspectAccessToken(token: string | null, team: string | undefined, audience: string | undefined): Promise<AccessResult> {
  const fail = (code: string): AccessResult => ({user: null, code});
  let stage = 'TOKEN_FORMAT';
  try {
    if (!team || !audience) return fail('CONFIG_MISSING');
    if (!token) return fail('TOKEN_MISSING');
    if (token.length > 16384) return fail('TOKEN_FORMAT');
    // Only the explicitly configured Cloudflare team may supply signing keys.
    if (!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(team)) return fail('CONFIG_FORMAT');
    const parts = token.split('.');
    if (parts.length !== 3) return fail('TOKEN_FORMAT');
    const header = JSON.parse(new TextDecoder().decode(decode(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(decode(parts[1])));
    const now = Math.floor(Date.now() / 1000);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return fail('TOKEN_ALGORITHM');
    if (claims.iss !== team) return fail('ISSUER_MISMATCH');
    if (!Array.isArray(claims.aud) || !claims.aud.includes(audience)) return fail('AUDIENCE_MISMATCH');
    if (typeof claims.exp !== 'number' || claims.exp <= now || typeof claims.iat !== 'number' || claims.iat > now + 30) return fail('TOKEN_TIME');
    if (claims.nbf !== undefined && (typeof claims.nbf !== 'number' || claims.nbf > now + 30)) return fail('TOKEN_TIME');
    if (typeof claims.sub !== 'string' || !claims.sub || typeof claims.email !== 'string' || !allowedEmails.has(claims.email.toLowerCase())) return fail('ACCOUNT_NOT_ALLOWED');
    stage = 'KEY_FETCH';
    if (!cached || cached.issuer !== team || cached.expires < Date.now() || !cached.keys.some(k => k.kid === header.kid)) {
      const response = await fetch(team + '/cdn-cgi/access/certs', { signal: AbortSignal.timeout(5000), redirect: 'error' });
      if (!response.ok) return fail('KEY_FETCH');
      const data = await response.json() as { keys?: Jwk[] };
      if (!Array.isArray(data.keys)) return fail('KEY_RESPONSE');
      cached = { issuer: team, keys: data.keys, expires: Date.now() + 300000 };
    }
    const jwk = cached.keys.find(k => k.kid === header.kid && k.kty === 'RSA' && (!k.alg || k.alg === 'RS256') && (!k.use || k.use === 'sig'));
    if (!jwk) return fail('KEY_NOT_FOUND');
    stage = 'KEY_IMPORT';
    const key = await crypto.subtle.importKey('jwk', jwk, {name:'RSASSA-PKCS1-v1_5', hash:'SHA-256'}, false, ['verify']);
    stage = 'SIGNATURE_CHECK';
    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]) as Uint8Array<ArrayBuffer>, new TextEncoder().encode(parts[0] + '.' + parts[1]));
    return valid ? {user: {userId: claims.sub, email: claims.email.toLowerCase()}, code: 'OK'} : fail('SIGNATURE_INVALID');
  } catch { return fail(stage); }
}
