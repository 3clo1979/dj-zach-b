/* Real Drizzle D1-generated SQL against isolated in-memory SQLite. All records
 * below are synthetic fixtures. No Cloudflare binding, network, or customer data. */
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), ts = require('typescript');
const { DatabaseSync } = require('node:sqlite');
const { drizzle } = require('drizzle-orm/d1');
const sqlite = new DatabaseSync(':memory:');
let manager = false, databaseReads = 0, beforeBatch = null;
// Resolve the existing owner allowlist from the application, rather than copy
// a real contact address into this synthetic test fixture.
const managerEmail = fs.readFileSync('app/lib.ts', 'utf8').match(/'([^'\s]+@[^'\s]+)'/)?.[1];
assert(managerEmail, 'manager allowlist is configured in the existing application');
const cache = new Map();
// Keep inquiry/public-date checks deterministic as the real calendar moves.
class TestDate extends Date {
  constructor(...args) { super(...(args.length ? args : ['2026-10-22T12:00:00Z'])); }
  static now() { return Date.parse('2026-10-22T12:00:00Z'); }
}
let db;
function moduleFor(file) {
  const resolved = path.resolve(file);
  if (cache.has(resolved)) return cache.get(resolved).exports;
  const module = { exports: {} }; cache.set(resolved, module);
  const code = ts.transpileModule(fs.readFileSync(resolved, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports,
    require(name) {
      if (name === '../../../db') return { getDb() { databaseReads++; return db; } };
      if (name.endsWith('cloudflare-auth')) return { getManagerUser: async () => manager ? { email: managerEmail } : null };
      if (name.startsWith('.')) return moduleFor(path.resolve(path.dirname(resolved), name) + '.ts');
      return require(name);
    },
    Response, Request, URL, crypto, Date: TestDate, JSON, Number, String, Array, Object, console, SyntaxError,
  }, { filename: file });
  return module.exports;
}
class Statement {
  constructor(sql, params = []) { this.sql = sql; this.params = params; }
  bind(...params) { return new Statement(this.sql, params); }
  rows() { return sqlite.prepare(this.sql).all(...this.params); }
  async raw() { return this.rows().map(row => Object.values(row)); }
  async all() { return { results: this.rows(), success: true, meta: {} }; }
  async run() { const result = sqlite.prepare(this.sql).run(...this.params); return { results: [], success: true, meta: { changes: result.changes } }; }
}
const binding = {
  prepare(sql) { return new Statement(sql); },
  async batch(statements) {
    const hook = beforeBatch; beforeBatch = null; hook?.();
    sqlite.exec('BEGIN');
    try {
      const results = statements.map(statement => ({ results: statement.rows(), success: true, meta: {} }));
      sqlite.exec('COMMIT'); return results;
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  },
};
const schema = moduleFor('db/schema.ts');
db = drizzle(binding, { schema });
const lead = moduleFor('app/api/inquiries/route.ts'), manage = moduleFor('app/api/manage/route.ts'), pub = moduleFor('app/api/events/route.ts');
const contract = moduleFor('app/event-details-contract.ts');
const req = (body, origin = 'https://test.local') => new Request('https://test.local/api/manage', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
const post = body => manage.POST(req(body));
const row = id => sqlite.prepare('SELECT * FROM events WHERE id = ?').get(id);
const inquiry = id => sqlite.prepare('SELECT * FROM inquiries WHERE id = ?').get(id);
const details = { servicePlan: 'DJ + uplighting\nBring two microphones', contactName: 'Local planner', contactEmail: 'local@example.invalid', contactPhone: '+1 (440) 555-0100 ext 2', notes: '  Keep this exact wording.\nBack entrance.  ' };
const update = (id, revision, values = {}) => ({ action: 'update-event-details', id, revision, ...details, ...values });
let groups = 0;
async function group(label, fn) { await fn(); groups++; console.log('✓ API: ' + label); }
(async () => {
  await group('additive migration preserves legacy records and creates NULL/private defaults', async () => {
    const migrations = fs.readdirSync('drizzle').filter(name => name.endsWith('.sql')).sort();
    assert.equal(migrations.at(-1), '0004_private_event_details.sql');
    for (const file of migrations.slice(0, -1)) sqlite.exec(fs.readFileSync('drizzle/' + file, 'utf8'));
    sqlite.prepare("INSERT INTO events(id,title,date,start,end,venue,type,notes) VALUES(?,?,?,?,?,?,?,?)").run('legacy', 'Local old booking', '2027-01-02', '', '', '', 'Private booking', 'Legacy notes\nUnchanged');
    sqlite.exec(fs.readFileSync('drizzle/0004_private_event_details.sql', 'utf8'));
    const legacy = row('legacy');
    assert.equal(legacy.notes, 'Legacy notes\nUnchanged'); assert.equal(legacy.revision, 'legacy');
    for (const field of ['service_plan', 'contact_name', 'contact_email', 'contact_phone']) assert.equal(legacy[field], null);
    const migration = fs.readFileSync('drizzle/0004_private_event_details.sql', 'utf8');
    assert.equal((migration.match(/ALTER TABLE/g) || []).length, 5); assert.doesNotMatch(migration, /DROP|DELETE|UPDATE|INSERT/i);
    const oldSnapshot = JSON.parse(fs.readFileSync('drizzle/meta/0003_snapshot.json', 'utf8'));
    const snapshot = JSON.parse(fs.readFileSync('drizzle/meta/0004_snapshot.json', 'utf8'));
    assert.equal(snapshot.prevId, oldSnapshot.id); assert.equal(snapshot.tables.events.columns.revision.type, 'text');
    assert.equal(snapshot.tables.events.columns.revision.default, "'legacy'");
    sqlite.prepare('DELETE FROM events WHERE id = ?').run('legacy');
  });
  await group('guards reject anonymous and cross-origin reads/writes before database access', async () => {
    const before = databaseReads;
    assert.equal((await manage.GET()).status, 403);
    assert.equal((await post({ action: 'event' })).status, 403);
    assert.equal((await post(update('missing', 'legacy'))).status, 403);
    assert.equal(databaseReads, before);
    manager = true;
    assert.equal((await manage.POST(req(update('missing', 'legacy'), 'https://other.test'))).status, 403);
    assert.equal(databaseReads, before);
    manager = false;
    assert.equal((await lead.POST(req({}))).status, 400);
    assert.equal((await lead.POST(req({}, 'https://other.test'))).status, 403);
  });
  const valid = { name: 'QA Test', email: 'qa@example.invalid', phone: '4405550100', date: '2027-06-12', venue: 'QA venue', eventType: 'Wedding', guests: '80', hours: '5–11 PM', services: ['DJ service', 'Uplighting', 'MC services'], message: 'Test only', consent: true };
  let id, linked;
  await group('new inquiry conversion prefills independent private fields exactly once', async () => {
    assert.equal((await lead.POST(req(valid))).status, 200);
    id = sqlite.prepare('SELECT id FROM inquiries').get().id; linked = 'booking-' + id;
    assert.deepEqual(JSON.parse(inquiry(id).services), valid.services);
    manager = true;
    assert.equal((await post({ action: 'status', id, status: 'Booked' })).status, 200);
    const event = row(linked);
    assert.equal(event.service_plan, valid.services.join('\n')); assert.equal(event.notes, valid.message);
    assert.equal(event.contact_name, valid.name); assert.equal(event.contact_email, valid.email); assert.equal(event.contact_phone, valid.phone);
    assert.match(event.revision, /^[0-9a-f-]{36}$/); assert.equal(event.is_public, 0);
    assert.deepEqual(await (await pub.GET()).json(), []);
    assert.equal((await post({ action: 'event', title: 'Conflict', date: valid.date, type: 'Public appearance', isPublic: true })).status, 409);
    const response = await post(update(linked, event.revision)); assert.equal(response.status, 200);
    const saved = row(linked); assert.notEqual(saved.revision, event.revision); assert.equal(saved.notes, details.notes);
    assert.equal((await post({ action: 'status', id, status: 'Booked' })).status, 200);
    assert.deepEqual(row(linked), saved, 'repeated Booked must never replace edited fields/revision');
    assert.equal(inquiry(id).name, valid.name, 'event edits never change source inquiry contact');
  });
  await group('legacy multiline inquiry contacts prefill single lines without rewriting source', async () => {
    const old = { ...valid, name: 'Local\r\nPlanner', phone: '440\n555\r\n0100', date: '2027-10-01', message: 'Keep\nmessage exactly' };
    assert.equal((await lead.POST(req(old))).status, 200);
    const oldId = sqlite.prepare('SELECT id FROM inquiries WHERE date = ?').get(old.date).id;
    assert.equal((await post({ action: 'status', id: oldId, status: 'Booked' })).status, 200);
    const event = row('booking-' + oldId);
    assert.equal(event.contact_name, 'Local Planner'); assert.equal(event.contact_phone, '440 555 0100');
    assert.equal(event.title, old.name + ' · ' + old.eventType); assert.equal(event.notes, old.message);
    assert.equal(inquiry(oldId).name, old.name); assert.equal(inquiry(oldId).phone, old.phone);
    assert.equal(contract.contactLine('  A\r\nB\0C  '), 'A B C');
    assert.equal((await post(update(event.id, event.revision, { contactName: event.contact_name, contactPhone: event.contact_phone }))).status, 200);
  });
  await group('explicit update schema rejects missing/null/invalid/extra fields without mutation', async () => {
    const saved = row(linked), good = update(linked, saved.revision);
    for (const key of ['revision', 'notes', 'servicePlan', 'contactName', 'contactEmail', 'contactPhone']) {
      const omitted = { ...good }; delete omitted[key]; assert.equal((await post(omitted)).status, 400, key + ' is required');
      assert.equal((await post({ ...good, [key]: null })).status, 400);
    }
    for (const [key, value] of Object.entries({ revision: 0, contactEmail: 'not-an-email', contactName: 'Bad\nName', contactPhone: '555\r\nextra', notes: 'x'.repeat(6001), servicePlan: 'x'.repeat(3001) })) assert.equal((await post({ ...good, [key]: value })).status, 400, key);
    for (const key of ['title', 'date', 'isPublic', 'type', 'facebook', 'venue']) assert.equal((await post({ ...good, [key]: key === 'isPublic' ? true : 'changed' })).status, 400);
    assert.equal((await post({ ...good, revision: 'not-a-version' })).status, 400);
    assert.deepEqual(row(linked), saved);
    assert.equal((await post(update('not-here', 'legacy'))).status, 404);
    const malformed = new Request('https://test.local/api/manage', { method: 'POST', headers: { Origin: 'https://test.local' }, body: '{' });
    assert.equal((await manage.POST(malformed)).status, 400);
  });
  await group('empty values are intentional, old long notes survive, legacy version updates once', async () => {
    const oldNotes = valid.services.join(', ') + '\n' + 'x'.repeat(3000);
    sqlite.prepare('UPDATE events SET service_plan=NULL, contact_name=NULL, contact_email=NULL, contact_phone=NULL, notes=?, revision=? WHERE id=?').run(oldNotes, 'legacy', linked);
    const response = await post(update(linked, 'legacy', { servicePlan: '', contactName: '', contactEmail: '', contactPhone: '', notes: oldNotes }));
    assert.equal(response.status, 200); const saved = row(linked);
    for (const field of ['service_plan', 'contact_name', 'contact_email', 'contact_phone']) assert.equal(saved[field], '');
    assert.equal(saved.notes, oldNotes); assert.notEqual(saved.revision, 'legacy');
    assert.equal((await post(update(linked, 'legacy'))).status, 409);
    assert.equal((await post({ action: 'status', id, status: 'Booked' })).status, 200);
    assert.deepEqual(row(linked), saved);
  });
  await group('two simultaneous edits use a real conditional SQL UPDATE; one wins', async () => {
    const version = row(linked).revision;
    const replies = await Promise.all([post(update(linked, version, { notes: 'First editor' })), post(update(linked, version, { notes: 'Second editor' }))]);
    assert.deepEqual(replies.map(response => response.status).sort(), [200, 409]);
    const winningIndex = replies.findIndex(response => response.status === 200);
    assert.equal(row(linked).notes, winningIndex === 0 ? 'First editor' : 'Second editor');
    assert.notEqual(row(linked).revision, version);
  });
  await group('status removal requires current acknowledgement; racing edit preserves both records', async () => {
    let saved = row(linked);
    assert.equal((await post({ action: 'status', id, status: 'Canceled' })).status, 409);
    assert.equal((await post({ action: 'status', id, status: 'Canceled', bookingRevision: crypto.randomUUID() })).status, 409);
    assert.deepEqual(row(linked), saved); assert.equal(inquiry(id).status, 'Booked');
    beforeBatch = () => sqlite.prepare('UPDATE events SET revision=?, notes=? WHERE id=?').run(crypto.randomUUID(), 'Changed during confirmation', linked);
    const response = await post({ action: 'status', id, status: 'Canceled', bookingRevision: saved.revision });
    assert.equal(response.status, 409);
    saved = row(linked); assert.equal(saved.notes, 'Changed during confirmation'); assert.equal(inquiry(id).status, 'Booked');
    assert.equal((await post({ action: 'status', id, status: 'Canceled', bookingRevision: saved.revision })).status, 200);
    assert.equal(row(linked), undefined); assert.equal(inquiry(id).status, 'Canceled');
    assert.equal((await post({ action: 'status', id, status: 'Booked' })).status, 200);
    const recreated = row(linked); assert.notEqual(recreated.revision, saved.revision);
    assert.equal((await post(update(linked, saved.revision, { notes: 'Stale canceled editor' }))).status, 409);
    assert.deepEqual(row(linked), recreated, 'cancel/rebook ABA cannot accept prior editor version');
  });
  await group('no-event status branch guards a concurrent booking and preserves lifecycle', async () => {
    const event = row(linked);
    assert.equal((await post({ action: 'status', id, status: 'Canceled', bookingRevision: event.revision })).status, 200);
    beforeBatch = () => {
      sqlite.prepare('UPDATE inquiries SET status=? WHERE id=?').run('Booked', id);
      sqlite.prepare('INSERT INTO events(id,title,date,start,end,venue,type,notes,revision) VALUES(?,?,?,?,?,?,?,?,?)').run(linked, 'Racing new booking', valid.date, '', '', valid.venue, 'Private booking', 'New plan', crypto.randomUUID());
    };
    assert.equal((await post({ action: 'status', id, status: 'Declined' })).status, 409);
    assert.equal(inquiry(id).status, 'Booked'); assert.equal(row(linked).notes, 'New plan');
    assert.equal((await post({ action: 'delete-event', id: linked, revision: row(linked).revision })).status, 400);
  });
  await group('manual appearance details stay private under create and update; URLs remain restricted', async () => {
    assert.equal((await post({ action: 'event', title: 'Public show', date: '2027-07-20', type: 'Public appearance', isPublic: true, facebook: 'https://www.facebook.com/events/123', ...details })).status, 200);
    const event = sqlite.prepare('SELECT * FROM events WHERE date = ?').get('2027-07-20');
    assert.equal(event.contact_email, details.contactEmail); assert.equal(event.service_plan, details.servicePlan);
    const response = await post(update(event.id, event.revision, { contactEmail: '  another@example.invalid  ', notes: 'New private note' }));
    assert.equal(response.status, 200); assert.equal(row(event.id).contact_email, 'another@example.invalid');
    const publicRows = await (await pub.GET()).json(); assert.equal(publicRows.length, 1);
    assert.deepEqual(Object.keys(publicRows[0]).sort(), ['date', 'end', 'facebook', 'id', 'start', 'title', 'venue']);
    for (const field of ['notes', 'servicePlan', 'contactName', 'contactEmail', 'contactPhone', 'revision']) assert.equal(publicRows[0][field], undefined);
    assert.equal((await post({ action: 'event', title: 'Unsafe link', date: '2027-08-20', type: 'Public appearance', facebook: 'javascript:alert(1)' })).status, 400);
    assert.equal((await post({ action: 'event', title: 'Wrong host', date: '2027-08-20', type: 'Public appearance', facebook: 'https://facebook.com.other.test/event' })).status, 400);
    assert.equal((await post({ action: 'event', title: 'Block', date: '2027-08-20', type: 'Blocked date', isPublic: true })).status, 200);
    const block = sqlite.prepare('SELECT * FROM events WHERE date = ?').get('2027-08-20'); assert.equal(block.is_public, 0); assert.equal(block.contact_name, '');
    assert.equal((await post({ action: 'delete-event', id: block.id, revision: block.revision })).status, 200);
    const privateResponse = await manage.GET(); assert.match(privateResponse.headers.get('cache-control'), /private.*no-store/);
    const data = await privateResponse.json(); assert.equal(data.events.find(item => item.id === event.id).contactEmail, 'another@example.invalid');
  });
  await group('racing occupied-date conflict rolls back the inquiry status transaction', async () => {
    const extra = { ...valid, date: '2027-09-20' };
    assert.equal((await lead.POST(req(extra))).status, 200);
    const otherId = sqlite.prepare('SELECT id FROM inquiries WHERE date = ?').get(extra.date).id;
    beforeBatch = () => sqlite.prepare('INSERT INTO events(id,title,date,start,end,venue,type,revision) VALUES(?,?,?,?,?,?,?,?)').run('racing-block', 'Local racing block', extra.date, '', '', '', 'Blocked date', crypto.randomUUID());
    assert.equal((await post({ action: 'status', id: otherId, status: 'Booked' })).status, 409);
    assert.equal(inquiry(otherId).status, 'New'); assert.equal(row('booking-' + otherId), undefined);
    assert.equal(row('racing-block').type, 'Blocked date');
  });
  await group('manual removal cannot delete a newer plan or proceed without its version', async () => {
    const event = sqlite.prepare('SELECT * FROM events WHERE date = ?').get('2027-07-20');
    assert.equal((await post({ action: 'delete-event', id: event.id })).status, 400);
    assert.equal((await post(update(event.id, event.revision, { notes: 'Newer manual plan' }))).status, 200);
    assert.equal((await post({ action: 'delete-event', id: event.id, revision: event.revision })).status, 409);
    assert.equal(row(event.id).notes, 'Newer manual plan');
    const saved = row(event.id);
    assert.equal((await post({ action: 'delete-event', id: event.id, revision: saved.revision })).status, 200);
    assert.equal(row(event.id), undefined);
    assert.equal((await post({ action: 'delete-event', id: event.id, revision: saved.revision })).status, 404);
  });
  await group('service prefill tolerates malformed legacy JSON without invented text', async () => {
    assert.equal(contract.inquiryServicePlan('["DJ service",1,null,"MC services"]'), 'DJ service\nMC services');
    for (const value of ['{', '', 'null', 'false', '"DJ"', '{}']) assert.equal(contract.inquiryServicePlan(value), '');
  });
  sqlite.close();
  console.log(`API checks passed: ${groups} groups; real local SQLite migrations + Drizzle D1 queries, no network or production data.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
