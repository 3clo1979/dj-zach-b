/* Local-only private-photo checks. Synthetic one-pixel fixture; no family photo,
 * network, credentials, Cloudflare writes, or production records are used. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { webcrypto } = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const ORIGIN = 'https://studio.example.test';
// Standard transparent 1x1 PNG: synthetic test fixture, not a user's image.
const png = Uint8Array.from(Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082', 'hex'));
// Locally generated 1x1 black JPEG, likewise not a user's image.
const jpeg = Uint8Array.from(Buffer.from('ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc40014000100000000000000000000000000000008ffc40014100100000000000000000000000000000000ffda0008010100003f003fbfffd9', 'hex'));

function harness({ migrate = true } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  let manager = false, queries = 0;
  const db = {
    prepare(sql) {
      const statement = values => ({
        bind(...args) { return statement(args); },
        async first() {
          queries++;
          const row = sqlite.prepare(sql).get(...values);
          if (!row) return null;
          return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Uint8Array ? Array.from(value) : value]));
        },
      });
      return statement([]);
    },
  };
  if (migrate) sqlite.exec(fs.readFileSync(path.join(root, 'drizzle/0003_private_studio_photo.sql'), 'utf8'));
  const modules = new Map();
  const context = vm.createContext({ Response, Request, Headers, URL, Uint8Array, DataView, ArrayBuffer, TextDecoder, TextEncoder, ReadableStream, Date, crypto: webcrypto });
  function load(file) {
    let full = path.resolve(root, file);
    if (!fs.existsSync(full)) full += '.ts';
    if (modules.has(full)) return modules.get(full).exports;
    const module = { exports: {} }; modules.set(full, module);
    const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const localRequire = name => {
      if (name === 'cloudflare:workers') return { env: { DB: db } };
      if (name.endsWith('/lib')) return { isManager: async () => manager };
      if (name.startsWith('.')) return load(path.resolve(path.dirname(full), name));
      return require(name);
    };
    vm.runInContext(`(function(require,module,exports){${code}\n})`, context, { filename: full })(localRequire, module, module.exports);
    return module.exports;
  }
  return {
    route: load('app/api/manage/studio-photo/route.ts'),
    server: load('app/studio-photo-server.ts'), sqlite,
    signIn() { manager = true; }, signOut() { manager = false; }, queryCount() { return queries; },
    count() { return sqlite.prepare('SELECT COUNT(*) AS count FROM studio_photo').get().count; },
    row() { return sqlite.prepare('SELECT * FROM studio_photo').get(); }, close() { sqlite.close(); },
  };
}
function req(method, { bytes = png, type = 'image/png', origin = ORIGIN, version = 'none', headers = {} } = {}) {
  const h = new Headers(headers);
  if (origin !== null) h.set('Origin', origin);
  if (type !== null) h.set('Content-Type', type);
  if (version !== null) h.set('X-Studio-Photo-Version', version);
  return new Request(ORIGIN + '/api/manage/studio-photo', { method, headers: h, body: method === 'POST' ? bytes : undefined, ...(bytes instanceof ReadableStream && method === 'POST' ? { duplex: 'half' } : {}) });
}
async function check(response, status) {
  assert.equal(response.status, status, await response.clone().text());
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.match(response.headers.get('content-security-policy'), /sandbox/);
  return response;
}
let groups = 0;
async function group(name, fn) { await fn(); groups++; console.log('✓ ' + name); }
(async () => {
  await group('auth before database or body reads; forged identity headers do not bypass', async () => {
    const h = harness();
    await check(await h.route.GET(), 403);
    await check(await h.route.POST(req('POST', { headers: { 'cf-access-authenticated-user-email': '3clo1979@gmail.com', 'x-auth-user': 'manager' } })), 403);
    await check(await h.route.DELETE(req('DELETE')), 403);
    assert.equal(h.queryCount(), 0); h.close();
  });
  await group('exact same-origin mutations; missing origin and version fail closed', async () => {
    const h = harness(); h.signIn();
    for (const origin of [null, 'https://other.example.test', 'null']) {
      await check(await h.route.POST(req('POST', { origin })), 403);
      await check(await h.route.DELETE(req('DELETE', { origin })), 403);
    }
    await check(await h.route.POST(req('POST', { version: null })), 428);
    await check(await h.route.POST(req('POST', { version: '*' })), 428);
    assert.equal(h.count(), 0); h.close();
  });
  await group('empty state; upload/read preserves exact original bytes and private headers', async () => {
    const h = harness(); h.signIn();
    const empty = await check(await h.route.GET(), 204); assert.equal(empty.headers.get('x-studio-photo-version'), 'none');
    await check(await h.route.POST(req('POST')), 200); assert.equal(h.count(), 1);
    const photo = await check(await h.route.GET(), 200);
    assert.equal(photo.headers.get('content-type'), 'image/png');
    assert.deepEqual(new Uint8Array(await photo.arrayBuffer()), png);
    assert.equal(photo.headers.get('x-studio-photo-version'), h.row().version);
    await check(await h.route.POST(req('POST', { bytes: jpeg, type: 'image/jpeg', version: h.row().version })), 200);
    const jpegResponse = await check(await h.route.GET(), 200);
    assert.equal(jpegResponse.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(new Uint8Array(await jpegResponse.arrayBuffer()), jpeg);
    h.signOut(); await check(await h.route.GET(), 403); h.close();
  });
  await group('only small JPEG/PNG containers; actual streamed limit, not trusted Content-Length', async () => {
    const h = harness(); h.signIn();
    for (const type of ['image/svg+xml', 'text/html', 'application/octet-stream', null]) await check(await h.route.POST(req('POST', { type })), 415);
    await check(await h.route.POST(req('POST', { type: 'image/jpeg' })), 400);
    await check(await h.route.POST(req('POST', { bytes: new TextEncoder().encode('<svg onload="alert(1)"/>') })), 400);
    await check(await h.route.POST(req('POST', { bytes: png.slice(0, 20) })), 400);
    const hugeDimensions = new Uint8Array(png); hugeDimensions.set([0,0,255,255], 16);
    await check(await h.route.POST(req('POST', { bytes: hugeDimensions })), 400);
    await check(await h.route.POST(req('POST', { headers: { 'Content-Length': '1000001' } })), 413);
    let canceled = false;
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(600000)); controller.enqueue(new Uint8Array(400001)); }, cancel() { canceled = true; } });
    await check(await h.route.POST(req('POST', { bytes: stream, headers: { 'Content-Length': '1' } })), 413);
    assert.equal(canceled, true); assert.equal(h.count(), 0); h.close();
  });
  await group('atomic version checks for replace/remove; no accidental recreation or silent overwrite', async () => {
    const h = harness(); h.signIn();
    await check(await h.route.POST(req('POST')), 200);
    const first = h.row().version;
    await check(await h.route.POST(req('POST')), 409);
    await check(await h.route.POST(req('POST', { version: first })), 200);
    const second = h.row().version; assert.notEqual(first, second);
    await check(await h.route.DELETE(req('DELETE', { version: first })), 409);
    await check(await h.route.POST(req('POST', { version: first })), 409);
    assert.equal(h.row().version, second);
    await check(await h.route.DELETE(req('DELETE', { version: second })), 200); assert.equal(h.count(), 0);
    await check(await h.route.POST(req('POST', { version: second })), 409);
    await check(await h.route.DELETE(req('DELETE', { version: second })), 409);
    await check(await h.route.GET(), 204); h.close();
  });
  await group('schema enforces single row, bounded size, allowed types; additive migration preserves data', async () => {
    const h = harness({ migrate: false });
    for (const name of ['0000_absurd_tiger_shark.sql', '0001_young_fabian_cortez.sql', '0002_client_testimonials.sql']) h.sqlite.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8'));
    h.sqlite.prepare('INSERT INTO events (id,title,date,start,end,venue,type,is_public,facebook,notes) VALUES (?,?,?,?,?,?,?,?,?,?)').run('test-local', 'Local test only', '2030-01-01', '', '', '', 'Blocked date', 0, '', 'kept');
    const before = h.sqlite.prepare('SELECT * FROM events').all();
    h.sqlite.exec(fs.readFileSync(path.join(root, 'drizzle/0003_private_studio_photo.sql'), 'utf8'));
    assert.deepEqual(h.sqlite.prepare('SELECT * FROM events').all(), before);
    const insert = h.sqlite.prepare('INSERT INTO studio_photo (id,bytes,content_type,version,updated_at) VALUES (?,?,?,?,?)');
    for (const values of [[2, png, 'image/png'], [1, new Uint8Array(1000001), 'image/png'], [1, png, 'image/svg+xml']]) assert.throws(() => insert.run(...values, 'test', '2026-10-22T00:00:00Z'), /CHECK constraint/);
    h.close();
  });
  await group('unavailable schema returns generic safe failure, not SQL internals', async () => {
    const h = harness({ migrate: false }); h.signIn();
    const response = await check(await h.route.GET(), 503);
    assert.doesNotMatch(await response.text(), /no such table|SELECT|studio_photo/); h.close();
  });
  console.log(`Private Studio photo: ${groups} groups passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
