/** Server-only request bounds without importing any processor or cloud binding. */
export class FinanceRequestProblem extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function readManageJson(req: Request, maxBytes = 24000): Promise<unknown> {
  if (req.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new FinanceRequestProblem('Submit a JSON request.', 400);
  if (Number(req.headers.get('content-length') || 0) > maxBytes) throw new FinanceRequestProblem('Request is too long.', 413);
  if (!req.body) throw new FinanceRequestProblem('Request body is required.', 400);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); throw new FinanceRequestProblem('Request is too long.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new FinanceRequestProblem('Please check your details.', 400); }
}
