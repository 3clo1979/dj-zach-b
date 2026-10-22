/* Local integration checks: real SQLite SQL/triggers + the real Drizzle D1 driver.
 * The D1 interface adapter below is test-only. No network, remote D1, or live submissions.
 * Access cryptography is independently covered by verify-access.cjs.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const ts = require('typescript');
const { webcrypto, randomUUID, createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const ORIGIN = 'https://test.local';
const migrations = ['0000_absurd_tiger_shark.sql', '0001_young_fabian_cortez.sql', '0002_client_testimonials.sql'];
const initialTime = Date.parse('2026-10-22T09:12:00.000Z');
let groups = 0;

function d1Adapter(sqlite) {
  const adapter = {
    beforeExecute: null,
    prepare(sql) {
      const statement = values => ({
        bind(...next) { return statement(next); },
        async raw() {
          adapter.beforeExecute?.(sql, values);
          const prepared = sqlite.prepare(sql);
          prepared.setReturnArrays(true);
          return prepared.all(...values);
        },
        async all() {
          adapter.beforeExecute?.(sql, values);
          const results = sqlite.prepare(sql).all(...values).map(row => ({ ...row }));
          return { success: true, results, meta: { changes: sqlite.prepare('SELECT changes() AS count').get().count } };
        },
        async first(column) {
          const result = (await this.all()).results[0] ?? null;
          return column && result ? result[column] : result;
        },
        async run() {
          adapter.beforeExecute?.(sql, values);
          const result = sqlite.prepare(sql).run(...values);
          return { success: true, results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
        },
      });
      return statement([]);
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.all());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  return adapter;
}

function harness({ migrate = true } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  if (migrate) for (const name of migrations) sqlite.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8'));
  const d1 = d1Adapter(sqlite);
  const env = { DB: d1 };
  let user = null;
  let time = initialTime;
  const modules = new Map();
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [time])); }
    static now() { return time; }
  }
  const context = vm.createContext({
    Response, Request, Headers, URL, crypto: webcrypto, Date: ClockDate,
    TextEncoder, TextDecoder, Uint8Array, ReadableStream, console,
  });
  function load(file) {
    let full = path.resolve(root, file);
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      full = [full + '.ts', path.join(full, 'index.ts')].find(f => fs.existsSync(f));
    }
    if (!full) throw new Error('Cannot resolve test module: ' + file);
    if (modules.has(full)) return modules.get(full).exports;
    const module = { exports: {} };
    modules.set(full, module);
    const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const localRequire = name => {
      if (name === 'cloudflare:workers') return { env };
      if (name.endsWith('cloudflare-auth')) return { getManagerUser: async () => user };
      if (name.endsWith('/lib')) return { isManager: async () => !!user && user.email.toLowerCase() === 'manager@example.test' };
      if (name.startsWith('.')) return load(path.resolve(path.dirname(full), name));
      return require(name);
    };
    vm.runInContext(`(function(require,module,exports){\n${code}\n})`, context, { filename: full })(localRequire, module, module.exports);
    return module.exports;
  }
  return {
    sqlite, d1, env,
    public: load('app/api/testimonials/route.ts'),
    manage: load('app/api/manage/testimonials/route.ts'),
    server: load('app/testimonials-server.ts'),
    contract: load('app/testimonials-contract.ts'),
    signIn(email = 'manager@example.test') { user = { email, userId: 'local-test-manager' }; },
    signOut() { user = null; },
    tick(ms) { time += ms; },
    now() { return time; },
    close() { sqlite.close(); },
    row(id) { const row = sqlite.prepare('SELECT * FROM testimonials WHERE id = ? OR submission_key = ?').get(id, createHash('sha256').update(id).digest('hex')); return row && { ...row }; },
    audit(id) { const storedId = this.row(id)?.id || id; return sqlite.prepare('SELECT * FROM testimonial_audit WHERE testimonial_id = ? ORDER BY id').all(storedId).map(r => ({ ...r })); },
    count(table) { return sqlite.prepare(`SELECT count(*) AS count FROM ${table}`).get().count; },
  };
}

function valid(overrides = {}) {
  return { submissionId: randomUUID(), displayName: 'Local QA Guest', email: 'private@example.test', eventType: 'Wedding',
    message: 'Local-only test feedback, not a real customer testimonial.', consent: true, consentVersion: '2026-10-22-v1', website: '', ...overrides };
}

function req(body, { origin = ORIGIN, ip = '192.0.2.4', type = 'application/json', headers = {}, raw = false } = {}) {
  const h = new Headers(headers);
  if (origin !== null) h.set('Origin', origin);
  if (ip !== null) h.set('CF-Connecting-IP', ip);
  if (type !== null) h.set('Content-Type', type);
  return new Request(ORIGIN + '/api/testimonials', { method: 'POST', headers: h, body: raw ? body : JSON.stringify(body), ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) });
}

async function expect(response, status, label) {
  assert.equal(response.status, status, `${label}: ${await response.clone().text()}`);
  assert.equal(response.headers.get('cache-control'), 'no-store', label + ': no cache');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff', label + ': no content sniffing');
  return response;
}

async function group(name, test) {
  await test(); groups++;
  console.log('✓ ' + name);
}

async function change(h, id, status, overrides = {}) {
  return h.manage.POST(req({ id: h.row(id).id, status, expectedUpdatedAt: h.row(id).updated_at, ...overrides }));
}

(async () => {
  await group('additive migration preserves existing inquiries and unique-date calendar', async () => {
    const h = harness({ migrate: false });
    for (const name of migrations.slice(0, 2)) h.sqlite.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8'));
    h.sqlite.exec(`INSERT INTO inquiries VALUES ('lead-before','Local QA','old-private@example.test','4405550100','2027-06-01','Local venue','Wedding','80','5-11','["DJ service"]','Original private note','Booked','2026-10-01');
      INSERT INTO events VALUES ('booking-before','Existing booking','2027-06-01','','','Local venue','Private booking',0,'','Private calendar note');`);
    const before = ['inquiries', 'events'].map(t => h.sqlite.prepare('SELECT * FROM ' + t).all().map(r => ({ ...r })));
    h.sqlite.exec(fs.readFileSync(path.join(root, 'drizzle', migrations[2]), 'utf8'));
    assert.deepEqual(['inquiries', 'events'].map(t => h.sqlite.prepare('SELECT * FROM ' + t).all().map(r => ({ ...r }))), before);
    assert.throws(() => h.sqlite.exec(`INSERT INTO events VALUES ('clash','Clash','2027-06-01','','','','Blocked date',0,'','')`), /UNIQUE/);
    assert.equal(h.count('testimonials'), 0); assert.equal(h.count('testimonial_audit'), 0); assert.equal(h.count('testimonial_rate_limits'), 0);
    h.close();
  });

  await group('migration replay preserves manually created schema, all rows, and single-fire audit triggers', async () => {
    const migration = fs.readFileSync(path.join(root, 'drizzle', migrations[2]), 'utf8');
    const objectNames = [
      'testimonial_audit', 'testimonial_audit_item_idx', 'testimonial_rate_limits',
      'testimonial_rate_expiry_idx', 'testimonials', 'testimonials_submission_key_unique',
      'testimonials_status_created_idx', 'testimonial_submitted_audit', 'testimonial_moderated_audit',
    ];
    assert.equal((migration.match(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|TRIGGER)\s+IF NOT EXISTS\b/gi) || []).length, 9,
      'all nine additive objects must be safe to replay');
    const schema = h => h.sqlite.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name IN (${objectNames.map(() => '?').join(',')}) ORDER BY name`)
      .all(...objectNames).map(row => ({ ...row, sql: row.sql.replace(/\s+/g, ' ').trim() }));
    const snapshot = h => Object.fromEntries(['inquiries', 'events', 'testimonials', 'testimonial_audit', 'testimonial_rate_limits', 'sqlite_sequence']
      .map(table => [table, h.sqlite.prepare('SELECT * FROM ' + table + ' ORDER BY rowid').all().map(row => ({ ...row }))]));
    const h = harness({ migrate: false });
    for (const name of migrations.slice(0, 2)) h.sqlite.exec(fs.readFileSync(path.join(root, 'drizzle', name), 'utf8'));
    // A manually applied console script omits Drizzle markers/comments. Same DDL,
    // no migration-history row: the automatic deployment will encounter it again.
    const consoleSql = migration.replace(/^\s*--[^\n]*(?:\n|$)/gm, '');
    h.sqlite.exec(consoleSql);
    const fresh = harness();
    assert.equal(schema(h).length, 9);
    assert.deepEqual(schema(h), schema(fresh), 'console and fresh migrations have identical definitions');
    for (const table of ['testimonials', 'testimonial_audit', 'testimonial_rate_limits']) {
      for (const pragma of ['table_info', 'foreign_key_list', 'index_list']) {
        assert.deepEqual(h.sqlite.prepare(`PRAGMA ${pragma}(${table})`).all(), fresh.sqlite.prepare(`PRAGMA ${pragma}(${table})`).all(), table + ' ' + pragma);
      }
    }
    fresh.close();
    h.sqlite.exec(`INSERT INTO inquiries VALUES ('replay-lead','Local QA','before@example.test','4405550100','2027-07-01','Local venue','Wedding','40','5-9','["DJ service"]','Existing private message','Booked','2026-10-01');
      INSERT INTO events VALUES ('replay-event','Existing event','2027-07-01','','','Local venue','Private booking',0,'','Existing private note');`);
    const existing = valid();
    await expect(await h.public.POST(req(existing)), 201, 'existing testimonial before replay');
    h.signIn(); await expect(await change(h, existing.submissionId, 'Published'), 200, 'existing publication before replay');
    const beforeRows = snapshot(h), beforeSchema = schema(h);
    assert.ok(beforeRows.testimonial_audit.length > 0 && beforeRows.testimonial_rate_limits.length > 0, 'audit and rate records included');
    const beforeChanges = h.sqlite.prepare('SELECT total_changes() AS count').get().count;
    h.sqlite.exec(migration);
    h.sqlite.exec(migration);
    assert.deepEqual(snapshot(h), beforeRows, 'replays preserve every existing row and sequence');
    assert.deepEqual(schema(h), beforeSchema, 'all nine schema objects remain unchanged');
    assert.equal(h.sqlite.prepare('SELECT total_changes() AS count').get().count, beforeChanges, 'replay performs no row writes');
    const next = valid({ email: 'after-replay@example.test' });
    await expect(await h.public.POST(req(next)), 201, 'new submission after replay');
    assert.equal(h.audit(next.submissionId).length, 1, 'submission trigger fires exactly once');
    await expect(await change(h, next.submissionId, 'Published'), 200, 'moderation after replay');
    assert.equal(h.audit(next.submissionId).length, 2, 'moderation trigger fires exactly once');
    await expect(await change(h, next.submissionId, 'Published'), 200, 'unchanged moderation after replay');
    assert.equal(h.audit(next.submissionId).length, 2, 'repeated state does not duplicate audit');
    assert.equal(h.audit(existing.submissionId).length, 2, 'existing audit remains unchanged');
    assert.throws(() => h.sqlite.exec("UPDATE testimonials SET status = 'Invalid'"), /CHECK/, 'status constraint survives replay');
    assert.throws(() => h.sqlite.exec('UPDATE testimonials SET published_at = NULL'), /CHECK/, 'publication constraint survives replay');
    assert.throws(() => h.sqlite.exec("UPDATE testimonials SET submission_key = 'duplicate-key'"), /UNIQUE/, 'unique retry-token constraint survives replay');
    assert.throws(() => h.sqlite.exec("INSERT INTO testimonial_audit (testimonial_id,to_status,created_at) VALUES ('missing','Pending','now')"), /FOREIGN KEY/, 'audit foreign key survives replay');
    h.close();
  });

  await group('anonymous and non-allowlisted managers cannot read or mutate', async () => {
    const h = harness();
    await expect(await h.manage.GET(), 403, 'anonymous manager read');
    await expect(await h.manage.POST(req({})), 403, 'anonymous manager write');
    h.signIn('not-authorized@example.test');
    await expect(await h.manage.GET(), 403, 'wrong email read');
    await expect(await h.manage.POST(req({})), 403, 'wrong email write');
    h.signIn('MANAGER@EXAMPLE.TEST');
    assert.deepEqual(await (await expect(await h.manage.GET(), 200, 'allowlisted manager')).json(), []);
    h.close();
  });

  await group('actual byte limits, JSON format, and same-origin checks fail closed', async () => {
    const h = harness();
    for (const origin of [null, 'https://different.test', 'https://test.local.evil.test', 'http://test.local', 'null']) {
      await expect(await h.public.POST(req(valid(), { origin })), 403, 'public disallowed origin ' + origin);
      h.signIn(); await expect(await h.manage.POST(req({}, { origin })), 403, 'manager disallowed origin ' + origin);
    }
    for (const type of [null, 'text/plain', 'application/x-www-form-urlencoded']) await expect(await h.public.POST(req(valid(), { type })), 415, 'wrong content type');
    await expect(await h.public.POST(req('{', { raw: true })), 400, 'malformed JSON');
    await expect(await h.public.POST(req('null', { raw: true })), 400, 'null JSON');
    await expect(await h.public.POST(req(new Uint8Array([0xff, 0xfe]), { raw: true })), 400, 'invalid UTF-8');
    await expect(await h.public.POST(req(valid(), { headers: { 'Content-Length': '16001' } })), 413, 'large advertised content');
    await expect(await h.public.POST(req('x'.repeat(16001), { raw: true, headers: { 'Content-Length': '1' } })), 413, 'lying small content length');
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(9000))); controller.enqueue(new TextEncoder().encode('x'.repeat(9000))); controller.close(); } });
    await expect(await h.public.POST(req(stream, { raw: true })), 413, 'chunked oversized body');
    await expect(await h.manage.POST(req({ padding: 'x'.repeat(2100) })), 413, 'smaller manager bound');
    assert.equal(h.count('testimonials'), 0);
    h.close();
  });

  await group('strict server validation, explicit consent, and honeypot discard', async () => {
    const h = harness();
    const cases = [
      { submissionId: 'not-a-uuid' }, { displayName: ' ' }, { displayName: 'x'.repeat(81) },
      { email: 'invalid' }, { eventType: 'Invented' }, { message: 'short' }, { message: 'x'.repeat(2001) },
      { consent: false }, { consent: undefined }, { consent: 'true' }, { consentVersion: undefined }, { status: 'Published' },
      { consentAt: '2000-01-01' }, { moderatedBy: 'attacker' }, { website: 123 },
    ];
    for (const changes of cases) await expect(await h.public.POST(req(valid(changes))), 400, 'reject ' + JSON.stringify(changes).slice(0, 100));
    await expect(await h.public.POST(req(valid({ consentVersion: 'old-version' }))), 409, 'stale permission version');
    await expect(await h.public.POST(req({ website: 'https://spam.test' })), 200, 'honeypot incomplete bot discard');
    await expect(await h.public.POST(req(valid({ website: ' spam ' }))), 200, 'honeypot full bot discard');
    assert.equal(h.count('testimonials'), 0); assert.equal(h.count('testimonial_audit'), 0); assert.equal(h.count('testimonial_rate_limits'), 0);
    h.close();
  });

  await group('pending storage, immutable original text, consent evidence, idempotent retries', async () => {
    const h = harness();
    const input = valid({ displayName: '  QA <b>Name</b>  ', email: '  PRIVATE@EXAMPLE.TEST  ', message: ' <img src=x onerror=alert(1)> Honest local test feedback. ' });
    await expect(await h.public.POST(req(input)), 201, 'valid pending submission');
    const row = h.row(input.submissionId);
    assert.equal(row.status, 'Pending'); assert.equal(row.display_name, input.displayName.trim()); assert.equal(row.email, 'private@example.test');
    assert.equal(row.message, input.message.trim()); assert.equal(row.created_at, new Date(h.now()).toISOString());
    assert.equal(row.consent_at, row.created_at); assert.equal(row.consent_version, h.contract.TESTIMONIAL_CONSENT_VERSION);
    assert.equal(row.updated_at, row.created_at); assert.equal(row.published_at, null); assert.equal(row.moderated_by, null);
    assert.deepEqual(await (await expect(await h.public.GET(), 200, 'pending public list')).json(), []);
    const rates = h.sqlite.prepare('SELECT key,count FROM testimonial_rate_limits ORDER BY key').all();
    await expect(await h.public.POST(req(input)), 200, 'same submission retry');
    assert.equal(h.count('testimonials'), 1); assert.equal(h.audit(row.id).length, 1);
    assert.deepEqual(h.sqlite.prepare('SELECT key,count FROM testimonial_rate_limits ORDER BY key').all(), rates, 'retries do not consume rate budget');
    await expect(await h.public.POST(req({ ...input, message: 'A different message with reused identifier.' })), 409, 'UUID collision');
    assert.equal(h.row(row.id).message, row.message);
    h.signIn(); const privateRows = await (await h.manage.GET()).json();
    assert.equal(privateRows[0].email, 'private@example.test');
    assert.equal(privateRows[0].consentVersion, row.consent_version);
    h.close();
  });

  await group('publish, unpublish, archive, restore, and publication privacy', async () => {
    const h = harness(); const input = valid();
    await h.public.POST(req(input)); h.signIn(); const id = input.submissionId;
    await expect(await change(h, id, 'Published'), 200, 'publish');
    let row = h.row(id);
    assert.equal(row.moderated_by, 'manager@example.test'); assert.equal(row.moderated_at, row.updated_at); assert.equal(row.published_at, row.updated_at);
    assert.ok(row.updated_at > row.created_at, 'monotonic timestamp even in same millisecond');
    const publicRows = await (await expect(await h.public.GET(), 200, 'published public list')).json();
    assert.equal(publicRows.length, 1);
    assert.deepEqual(Object.keys(publicRows[0]).sort(), ['id', 'displayName', 'eventType', 'message', 'publishedAt'].sort());
    assert.equal(publicRows[0].message, input.message);
    const publicText = JSON.stringify(publicRows);
    assert.ok(!publicText.includes(input.email)); assert.ok(!publicText.includes(row.moderated_by)); assert.ok(!publicText.includes('consentVersion'));
    await expect(await change(h, id, 'Pending'), 200, 'unpublish');
    assert.deepEqual(await (await h.public.GET()).json(), []); assert.equal(h.row(id).published_at, null);
    await expect(await change(h, id, 'Archived'), 200, 'archive');
    await expect(await change(h, id, 'Published'), 400, 'cannot skip archived review');
    await expect(await change(h, id, 'Pending'), 200, 'restore');
    await expect(await change(h, id, 'Published'), 200, 'republish');
    assert.equal(h.row(id).message, input.message, 'moderation never rewrites original');
    const audit = h.audit(id);
    assert.deepEqual(audit.map(a => a.to_status), ['Pending', 'Published', 'Pending', 'Archived', 'Pending', 'Published']);
    assert.equal(audit[0].actor, null); assert.equal(audit[0].from_status, null);
    for (const event of audit.slice(1)) { assert.equal(event.actor, 'manager@example.test'); assert.ok(event.created_at); }
    h.close();
  });

  await group('published identifiers cannot be used as private-email guessing tokens', async () => {
    for (const guess of ['private@example.test', 'wrong-guess@example.test']) {
      const h = harness(); const input = valid();
      await h.public.POST(req(input)); h.signIn();
      await change(h, input.submissionId, 'Published');
      const published = (await (await h.public.GET()).json())[0];
      assert.notEqual(published.id, input.submissionId, 'public UUID is not the private retry token');
      assert.ok(!JSON.stringify(published).includes('submissionKey'));
      const response = await expect(await h.public.POST(req({ ...input, submissionId: published.id, email: guess })), 201, 'public ID always starts a new submission');
      assert.deepEqual(await response.json(), { ok: true });
      assert.equal(h.count('testimonials'), 2);
      assert.equal((await (await h.public.GET()).json()).length, 1, 'guessed submission remains pending');
      await expect(await h.public.POST(req(input)), 200, 'original private retry token still works');
      assert.equal(h.count('testimonials'), 2);
      h.close();
    }
  });

  await group('stale writes, repeated actions, unknown fields, and concurrent moderation', async () => {
    const h = harness(); const input = valid(); await h.public.POST(req(input)); h.signIn(); const id = input.submissionId;
    const original = h.row(id).updated_at;
    await expect(await change(h, id, 'Published'), 200, 'initial publish');
    await expect(await change(h, id, 'Pending', { expectedUpdatedAt: original }), 409, 'stale version');
    const auditLength = h.audit(id).length, published = h.row(id).updated_at;
    await expect(await change(h, id, 'Published'), 200, 'same state idempotent');
    assert.equal(h.audit(id).length, auditLength); assert.equal(h.row(id).updated_at, published);
    await expect(await change(h, id, 'Pending', { message: 'Unwanted rewrite attempt' }), 400, 'unknown manager field');
    await expect(await change(h, id, 'Deleted'), 400, 'unknown status');
    await expect(await change(h, id, 'Pending', { expectedUpdatedAt: 'not-a-date' }), 400, 'invalid version');
    await expect(await h.manage.POST(req({ id: randomUUID(), status: 'Pending', expectedUpdatedAt: published })), 404, 'unknown row');
    h.d1.beforeExecute = sql => {
      if (/^update "testimonials"/i.test(sql)) {
        h.d1.beforeExecute = null;
        h.sqlite.prepare('UPDATE testimonials SET updated_at = ? WHERE id = ?').run('2026-10-22T09:12:00.999Z', h.row(id).id);
      }
    };
    await expect(await change(h, id, 'Pending'), 409, 'compare-and-swap concurrent change');
    assert.equal(h.row(id).status, 'Published'); assert.equal(h.audit(id).length, auditLength);
    h.close();
  });

  await group('audit failure rolls back the publication atomically', async () => {
    const h = harness(); const input = valid(); await h.public.POST(req(input)); h.signIn();
    h.sqlite.exec(`CREATE TRIGGER test_audit_failure BEFORE INSERT ON testimonial_audit WHEN NEW.actor IS NOT NULL BEGIN SELECT RAISE(ABORT, 'Local test audit failure'); END;`);
    await expect(await change(h, input.submissionId, 'Published'), 503, 'audit failure');
    assert.equal(h.row(input.submissionId).status, 'Pending'); assert.equal(h.audit(input.submissionId).length, 1);
    assert.deepEqual(await (await h.public.GET()).json(), []);
    h.close();
  });

  await group('concurrent duplicate submissions create exactly one pending row and audit', async () => {
    const h = harness(); const input = valid();
    const responses = await Promise.all([h.public.POST(req(input)), h.public.POST(req(input))]);
    for (const response of responses) assert.ok([200, 201].includes(response.status));
    assert.equal(h.count('testimonials'), 1); assert.equal(h.audit(input.submissionId).length, 1);
    h.close();
  });

  await group('concurrent conflicting retry token cannot replace original feedback', async () => {
    const h = harness(); const first = valid(), second = { ...first, message: 'A separate local test message using the same token.' };
    const responses = await Promise.all([h.public.POST(req(first)), h.public.POST(req(second))]);
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
    assert.equal(h.count('testimonials'), 1); assert.equal(h.audit(first.submissionId).length, 1);
    assert.ok([first.message, second.message].includes(h.row(first.submissionId).message));
    h.close();
  });

  await group('email rate limit persists with Retry-After and daily reset', async () => {
    const h = harness();
    for (let i = 0; i < 3; i++) await expect(await h.public.POST(req(valid(), { ip: '192.0.2.' + i })), 201, 'email allowance');
    let response = await expect(await h.public.POST(req(valid(), { ip: '192.0.2.99' })), 429, 'email budget');
    assert.equal(response.headers.get('retry-after'), '86400'); assert.equal(h.count('testimonials'), 3);
    h.tick(24 * 3600000);
    await expect(await h.public.POST(req(valid(), { ip: '192.0.2.99' })), 201, 'next day');
    h.close();
  });

  await group('network rate limit ignores X-Forwarded-For and unknown IP cannot bypass it', async () => {
    for (const ip of ['198.51.100.10', null]) {
      const h = harness();
      for (let i = 0; i < 10; i++) await expect(await h.public.POST(req(valid({ email: `network${i}@example.test` }), { ip, headers: { 'X-Forwarded-For': '192.0.2.' + i } })), 201, 'network allowance');
      const response = await expect(await h.public.POST(req(valid({ email: 'over-limit@example.test' }), { ip, headers: { 'X-Forwarded-For': '203.0.113.254' } })), 429, 'network budget');
      assert.equal(response.headers.get('retry-after'), '3600'); assert.equal(h.count('testimonials'), 10);
      const counters = h.sqlite.prepare('SELECT key,count FROM testimonial_rate_limits').all();
      assert.ok(!JSON.stringify(counters).includes('198.51.100.10')); assert.ok(!JSON.stringify(counters).includes('@example.test'));
      h.tick(3600000);
      await expect(await h.public.POST(req(valid({ email: 'after-reset@example.test' }), { ip })), 201, 'next hour');
      h.close();
    }
  });

  await group('global rate ceiling bounds keys/counters and expires old fingerprints', async () => {
    const h = harness();
    for (let i = 0; i < 120; i++) assert.equal(await h.server.consumeTestimonialLimit(req({}, { ip: `203.0.113.${i}` }), `unique${i}@example.test`, h.now()), 0);
    const before = h.count('testimonial_rate_limits'); assert.equal(before, 241);
    for (let i = 0; i < 8; i++) assert.equal(await h.server.consumeTestimonialLimit(req({}, { ip: `203.0.113.${200 + i}` }), `over${i}@example.test`, h.now()), 3600);
    assert.equal(h.count('testimonial_rate_limits'), before, 'global block creates no further network/email keys');
    assert.equal(h.sqlite.prepare("SELECT count FROM testimonial_rate_limits WHERE key LIKE 'global:%'").get().count, 121, 'counter saturated');
    h.tick(3 * 86400000);
    assert.equal(await h.server.consumeTestimonialLimit(req({}), 'fresh@example.test', h.now()), 0);
    assert.equal(h.count('testimonial_rate_limits'), 3, 'expired keys purged on next accepted attempt');
    h.close();
  });

  await group('concurrent rate requests cannot overspend network or global budgets', async () => {
    const h = harness();
    const network = await Promise.all(Array.from({ length: 20 }, (_, i) => h.server.consumeTestimonialLimit(req({}), `burst${i}@example.test`, h.now())));
    assert.equal(network.filter(v => v === 0).length, 10); assert.equal(network.filter(v => v === 3600).length, 10);
    h.close();
    const g = harness();
    const global = await Promise.all(Array.from({ length: 160 }, (_, i) => g.server.consumeTestimonialLimit(req({}, { ip: '203.0.113.' + i }), `global${i}@example.test`, g.now())));
    assert.equal(global.filter(v => v === 0).length, 120); assert.equal(global.filter(v => v === 3600).length, 40);
    assert.equal(g.count('testimonial_rate_limits'), 241);
    g.close();
  });

  await group('public output is capped and publication constraints reject invalid state', async () => {
    const h = harness();
    const insert = h.sqlite.prepare(`INSERT INTO testimonials (id,submission_key,display_name,email,event_type,message,status,consent_at,consent_version,created_at,updated_at,published_at,moderated_at,moderated_by) VALUES (?,?,?,?,?,?,'Published',?,?,?,?,?,?,?)`);
    for (let i = 0; i < 27; i++) {
      const date = new Date(initialTime + i).toISOString();
      insert.run(randomUUID(), 'test-fixture-token-' + i, 'QA ' + i, 'private' + i + '@example.test', 'Wedding', 'Local-only SQL fixture, never deployed.', date, 'test-v1', date, date, date, date, 'manager@example.test');
    }
    const publicRows = await (await h.public.GET()).json();
    assert.equal(publicRows.length, 24); assert.equal(publicRows[0].displayName, 'QA 26'); assert.equal(publicRows[23].displayName, 'QA 3');
    assert.throws(() => h.sqlite.exec("UPDATE testimonials SET status = 'Unexpected'"), /CHECK/);
    assert.throws(() => h.sqlite.exec('UPDATE testimonials SET published_at = NULL'), /CHECK/);
    h.close();
  });

  await group('missing database and missing migration never expose data or accept submissions', async () => {
    for (const missing of ['binding', 'migration']) {
      const h = harness({ migrate: missing !== 'migration' }); h.signIn();
      if (missing === 'binding') h.env.DB = undefined;
      await expect(await h.public.GET(), 503, missing + ' public failure');
      await expect(await h.public.POST(req(valid())), 503, missing + ' submission failure');
      await expect(await h.manage.GET(), 503, missing + ' manager failure');
      h.close();
    }
  });

  console.log(`Testimonial checks passed: ${groups} integration groups using real SQLite + Drizzle; no live data or external requests.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
