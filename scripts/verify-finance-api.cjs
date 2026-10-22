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
    Response, Request, URL, crypto, TextDecoder, Uint8Array, Date: TestDate, JSON, Number, String, Array, Object, console, SyntaxError,
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
async function group(label, fn) { if (sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name='finance_rate_limits'").get()) sqlite.exec('DELETE FROM finance_rate_limits'); await fn(); groups++; console.log('✓ Finance API: ' + label); }
const financial = id => sqlite.prepare('SELECT * FROM financial_records WHERE id=?').get(id);
const rev = id => inquiry(id).revision;
const status = (id, status, extra = {}) => post({ action: 'status', id, status, inquiryRevision: rev(id), ...extra });
const payment = (id, extra = {}) => ({ action: 'record-payment', id, inquiryRevision: rev(id), recordId: crypto.randomUUID(), kind: 'payment', amount: '250.00', paidOn: '2026-10-21', method: 'Venmo', ...extra });
const voidRecord = (id, recordId, extra = {}) => post({ action: 'void-payment', id, inquiryRevision: rev(id), recordId, reason: 'Correcting a duplicate entry', ...extra });
const count = table => sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get().n;
const history = id => sqlite.prepare('SELECT * FROM inquiry_status_history WHERE inquiry_id=? ORDER BY id').all(id);
const amountHistory = id => sqlite.prepare('SELECT * FROM inquiry_amount_history WHERE inquiry_id=? ORDER BY id').all(id);
const valid = { name: 'Fictional client', email: 'bookings@example.test', phone: '4405550100', date: '2027-06-12', venue: 'Fictional venue', eventType: 'Wedding', guests: '80', hours: '5–11 PM', services: ['DJ service', 'Uplighting'], message: 'Synthetic only', consent: true };
let sequence = 0;
async function newInquiry(extra = {}) {
  const value = { ...valid, date: `2027-08-${String(++sequence).padStart(2, '0')}`, ...extra };
  const response = await lead.POST(req(value)); assert.equal(response.status, 200, await response.text());
  return sqlite.prepare('SELECT id FROM inquiries WHERE date=? ORDER BY rowid DESC').get(value.date).id;
}
(async () => {
  await group('additive migration preserves unknown legacy values, private event fields, and no invented status dates', async () => {
    sqlite.exec('PRAGMA foreign_keys=ON');
    for (const file of fs.readdirSync('drizzle').filter(name => name.endsWith('.sql') && name < '0005').sort()) sqlite.exec(fs.readFileSync('drizzle/' + file, 'utf8'));
    sqlite.prepare("INSERT INTO inquiries(id,name,email,phone,date,venue,event_type,guests,hours,services,message,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run('legacy', 'Legacy client', 'legacy@example.test', '555', '2028-01-01', 'Legacy venue', 'Wedding', '', '', '[]', 'Keep original', 'Booked', '2026-01-01T12:00:00Z');
    sqlite.prepare("INSERT INTO events(id,title,date,start,end,venue,type,notes,service_plan,contact_name,contact_email,contact_phone,revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run('booking-legacy', 'Legacy booking', '2028-01-01', '', '', 'Legacy venue', 'Private booking', 'Keep private notes', 'Keep services', 'Keep name', 'private@example.test', '555', 'legacy');
    const priorInquiry = inquiry('legacy'), priorEvent = row('booking-legacy');
    const migration = fs.readFileSync('drizzle/0005_booking_finances.sql', 'utf8');
    sqlite.exec(migration);
    for (const [key, value] of Object.entries(priorInquiry)) assert.equal(inquiry('legacy')[key], value);
    assert.deepEqual(row('booking-legacy'), priorEvent);
    assert.equal(inquiry('legacy').revision, 'legacy');
    for (const key of ['referral_source','referral_other','quoted_amount_cents','booked_amount_cents','changed_at','changed_by']) assert.equal(inquiry('legacy')[key], null);
    assert.equal(history('legacy').length, 0); assert.equal(amountHistory('legacy').length, 0);
    assert.equal(count('financial_records'), 0);
    assert.doesNotMatch(migration, /DROP TABLE|PRAGMA foreign_keys=OFF|INSERT INTO inquiries|UPDATE inquiries SET/i);
    const prior = JSON.parse(fs.readFileSync('drizzle/meta/0004_snapshot.json','utf8'));
    const current = JSON.parse(fs.readFileSync('drizzle/meta/0005_snapshot.json','utf8'));
    const journal = JSON.parse(fs.readFileSync('drizzle/meta/_journal.json','utf8'));
    assert.equal(current.prevId, prior.id); assert.equal(journal.entries.at(-1).tag, '0005_booking_finances');
    assert.equal(current.tables.inquiries.columns.quoted_amount_cents.type, 'integer');
    assert.equal(current.tables.financial_records.columns.void_reason.type, 'text');
  });
  await group('authentication and exact origin fail closed before bookkeeping access', async () => {
    const before = databaseReads;
    for (const action of ['record-payment','void-payment','amounts','status']) assert.equal((await post({ action })).status, 403);
    assert.equal((await manage.GET()).status, 403); assert.equal(databaseReads,before);
    manager = true;
    assert.equal((await manage.POST(req({ action:'amounts' },'https://other.test'))).status,403);
    const missing = new Request('https://test.local/api/manage',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal((await manage.POST(missing)).status,403); assert.equal(databaseReads,before);
  });
  await group('referral enum and bounded Other text remain optional, private, and unknown on old records', async () => {
    const id = await newInquiry(); assert.equal(inquiry(id).referral_source,null); assert.equal(inquiry(id).referral_other,null);
    for (const source of ['Google','Social media','Friend / family','Venue / vendor','Returning client','Other']) {
      const saved = await newInquiry({referralSource:source,referralOther:source==='Other'?'Neighborhood fair':null});
      assert.equal(inquiry(saved).referral_source,source);
    }
    const before = count('inquiries');
    for (const extra of [{referralSource:'Website'},{referralSource:'google'},{referralSource:'Other',referralOther:'x'.repeat(161)},{referralSource:'Google',referralOther:'wrong combo'},{referralSource:'Other',referralOther:'Bad\ntext'},{referralSource:'Other',referralOther:'trailing\n'},{referralOther:'Unknown source'}]) assert.equal((await lead.POST(req({...valid,...extra}))).status,400);
    assert.equal(count('inquiries'),before);
    assert.equal(history(id).length,1); assert.equal(history(id)[0].from_status,null); assert.equal(history(id)[0].to_status,'New');
    const untrusted=await newInquiry({status:'Booked',quotedAmountCents:1,bookedAmountCents:2,changedBy:'spoof@example.test',revision:crypto.randomUUID()});
    assert.equal(inquiry(untrusted).status,'New');assert.equal(inquiry(untrusted).quoted_amount_cents,null);assert.equal(inquiry(untrusted).booked_amount_cents,null);assert.equal(inquiry(untrusted).changed_by,null);assert.equal(inquiry(untrusted).revision,'legacy');
  });
  let id, linked;
  await group('quote, agreed amount, skip, explicit zero and audited corrections stay distinct', async () => {
    id=await newInquiry({referralSource:'Google'});linked='booking-'+id;
    assert.equal((await status(id,'Quote sent',{amount:'1500.25'})).status,200);
    assert.equal(inquiry(id).quoted_amount_cents,150025);assert.equal(inquiry(id).booked_amount_cents,null);
    assert.equal((await status(id,'Booked')).status,200); assert.equal(inquiry(id).booked_amount_cents,null,'omission skips price');
    assert.equal((await status(id,'Booked',{amount:'0'})).status,200); assert.equal(inquiry(id).booked_amount_cents,0);
    assert.equal((await status(id,'Booked',{amount:'1450.75'})).status,200);assert.equal(inquiry(id).quoted_amount_cents,150025);
    assert.equal(history(id).length,3,'same-status amount updates do not invent new booking transitions');
    const audits=amountHistory(id);assert.equal(audits.length,3);assert.equal(audits[0].from_quoted_cents,null);assert.equal(audits[0].to_quoted_cents,150025);assert.equal(audits[1].to_booked_cents,0);assert.equal(audits[2].from_booked_cents,0);
    assert(audits.every(item=>item.actor===managerEmail.toLowerCase()&&item.created_at==='2026-10-22T12:00:00.000Z'));
    assert.equal((await post({action:'amounts',id,inquiryRevision:rev(id),quotedAmount:null,bookedAmount:'1600'})).status,200);
    assert.equal(inquiry(id).quoted_amount_cents,null);assert.equal(inquiry(id).booked_amount_cents,160000);
    assert.equal(row(linked).service_plan,valid.services.join('\n'));assert.equal(row(linked).notes,valid.message);
  });
  await group('money inputs reject negative, malformed, exponent, floats, NaN, overprecision and stale revisions', async () => {
    const original=inquiry(id);const before=count('inquiry_amount_history');
    for(const amount of ['-1','NaN','Infinity','1e2','1.001','1,000',' 2','2 ','01','.5','1.','1000000',100,0,{},[]]) {
      assert.equal((await status(id,'Booked',{amount})).status,400,JSON.stringify(amount));
      assert.equal((await post(payment(id,{amount}))).status,400,JSON.stringify(amount));
    }
    assert.equal((await post(payment(id,{amount:'0'}))).status,400);
    assert.equal((await status(id,'Contacted',{amount:'5'})).status,400);
    assert.equal((await post({action:'status',id,status:'Booked'})).status,400);
    assert.equal((await status(id,'Booked',{inquiryRevision:'legacy',amount:'5'})).status,409);
    assert.deepEqual(inquiry(id),original);assert.equal(count('inquiry_amount_history'),before);
    assert.equal((await post({action:'amounts',id,inquiryRevision:rev(id),quotedAmount:'0.01',bookedAmount:'999999.99'})).status,200);
    assert.equal(inquiry(id).booked_amount_cents,99999999);
  });
  let deposit, balance, refund;
  await group('multiple manual payments and refunds are append-only and exact retries are idempotent', async () => {
    deposit=payment(id,{amount:'250',method:'Venmo'});assert.equal((await post(deposit)).status,200);
    const initial=financial(deposit.recordId);assert.equal(initial.amount_cents,25000);assert.equal(initial.created_by,managerEmail.toLowerCase());
    assert.equal((await post(deposit)).status,200);assert.equal(count('financial_records'),1);assert.deepEqual(financial(deposit.recordId),initial);
    assert.equal((await post({...deposit,amount:'251'})).status,409);assert.equal(count('financial_records'),1);
    balance=payment(id,{amount:'750.50',method:'Stripe'});assert.equal((await post(balance)).status,200);
    refund=payment(id,{amount:'100.25',kind:'refund',method:'PayPal'});assert.equal((await post(refund)).status,200);
    const net=sqlite.prepare("SELECT sum(CASE WHEN kind='payment' THEN amount_cents ELSE -amount_cents END) AS cents FROM financial_records WHERE inquiry_id=? AND voided_at IS NULL").get(id).cents;
    assert.equal(net,90025);assert.equal(inquiry(id).booked_amount_cents,99999999,'receipts do not rewrite agreement');
    assert.equal((await post(payment(id,{kind:'refund',amount:'900.26'}))).status,409);
    assert.equal(count('financial_records'),3);
  });
  await group('refund correction uses audited void and immutable original record, without hiding history',async()=>{
    assert.equal((await voidRecord(id,balance.recordId)).status,200,'remaining payment covers refund');
    assert.equal((await voidRecord(id,deposit.recordId)).status,409,'cannot void funds backing refund');
    assert.equal(financial(deposit.recordId).voided_at,null);
    assert.equal((await voidRecord(id,refund.recordId,{reason:'Refund amount entered incorrectly'})).status,200);
    assert.equal((await voidRecord(id,deposit.recordId)).status,200);
    const voided=financial(deposit.recordId);assert.equal(voided.void_reason,'Correcting a duplicate entry');assert.equal(voided.voided_by,managerEmail.toLowerCase());
    assert.equal((await voidRecord(id,deposit.recordId)).status,200);assert.equal((await voidRecord(id,deposit.recordId,{reason:'Replace audit reason'})).status,409);
    assert.equal((await post(deposit)).status,200,'original retry never recreates a voided payment');
    assert.deepEqual(financial(deposit.recordId),voided);assert.equal(count('financial_records'),3);
    assert.throws(()=>sqlite.prepare('DELETE FROM financial_records WHERE id=?').run(deposit.recordId),/cannot be deleted/);
    assert.throws(()=>sqlite.prepare('UPDATE financial_records SET amount_cents=1 WHERE id=?').run(balance.recordId),/immutable/);
    assert.throws(()=>sqlite.prepare('UPDATE financial_records SET void_reason=? WHERE id=?').run('replace',deposit.recordId),/immutable/);
  });
  await group('DB integrity independently rejects over-refunds, invalid cents/methods, incomplete voids and source mismatches',async()=>{
    const insert=sqlite.prepare('INSERT INTO financial_records(id,inquiry_id,kind,amount_cents,paid_on,method,created_at,created_by) VALUES(?,?,?,?,?,?,?,?)');
    assert.throws(()=>insert.run(crypto.randomUUID(),id,'refund',1,'2026-10-20','Cash','2026-10-22T12:00:00Z','fixture@example.test'),/exceeds/);
    for(const amount of [-1,0,1.5,100000000]) assert.throws(()=>insert.run(crypto.randomUUID(),id,'payment',amount,'2026-10-20','Cash','2026-10-22T12:00:00Z','fixture@example.test'),/CHECK constraint/);
    assert.throws(()=>insert.run(crypto.randomUUID(),id,'payment',1,'2026-10-20','Wire','2026-10-22T12:00:00Z','fixture@example.test'),/CHECK constraint/);
    const incoming=payment(id);assert.equal((await post(incoming)).status,200);
    assert.throws(()=>sqlite.prepare('UPDATE financial_records SET voided_at=?,voided_by=? WHERE id=?').run('2026-10-22T12:00:00Z','fixture@example.test',incoming.recordId),/CHECK constraint/);
    assert.throws(()=>sqlite.prepare('UPDATE inquiries SET referral_source=NULL,referral_other=? WHERE id=?').run('wrong',id),/CHECK constraint/);
    assert.throws(()=>sqlite.prepare('DELETE FROM inquiries WHERE id=?').run(id),/FOREIGN KEY constraint/);
  });
  await group('cancellation and rebooking preserve all money, source data and history without duplicate receipts',async()=>{
    const payments=sqlite.prepare('SELECT * FROM financial_records WHERE inquiry_id=? ORDER BY id').all(id);
    const quote=inquiry(id).quoted_amount_cents,booked=inquiry(id).booked_amount_cents;
    assert.equal((await status(id,'Canceled',{bookingRevision:row(linked).revision})).status,200);assert.equal(row(linked),undefined);
    assert.deepEqual(sqlite.prepare('SELECT * FROM financial_records WHERE inquiry_id=? ORDER BY id').all(id),payments);
    assert.equal((await status(id,'Booked')).status,200);assert(row(linked));assert.equal(inquiry(id).quoted_amount_cents,quote);assert.equal(inquiry(id).booked_amount_cents,booked);assert.equal(inquiry(id).referral_source,'Google');
    assert.equal((await status(id,'Booked')).status,200);assert.equal(history(id).filter(item=>item.to_status==='Booked').length,2);
    assert.deepEqual(sqlite.prepare('SELECT * FROM financial_records WHERE inquiry_id=? ORDER BY id').all(id),payments);
    assert.equal((await status('legacy','Booked')).status,200);assert.equal(history('legacy').length,0,'reconfirming legacy Booked must not invent historical date');
  });
  await group('stale status CAS cannot remove an event or create an event after concurrent cancellation',async()=>{
    let original=row(linked);beforeBatch=()=>sqlite.prepare('UPDATE inquiries SET revision=? WHERE id=?').run(crypto.randomUUID(),id);
    assert.equal((await status(id,'Canceled',{bookingRevision:original.revision})).status,409);assert.deepEqual(row(linked),original);assert.equal(inquiry(id).status,'Booked');
    assert.equal((await status(id,'Canceled',{bookingRevision:original.revision})).status,200);
    beforeBatch=()=>sqlite.prepare('UPDATE inquiries SET revision=? WHERE id=?').run(crypto.randomUUID(),id);
    assert.equal((await status(id,'Booked')).status,409);assert.equal(row(linked),undefined);assert.equal(inquiry(id).status,'Canceled');
    assert.equal((await status(id,'Booked')).status,200);
  });
  await group('two concurrent receipts with same revision cannot double-write; identical retry is successful once',async()=>{
    let version=rev(id);const first=payment(id),second=payment(id,{inquiryRevision:version,amount:'500'});
    const responses=await Promise.all([post(first),post(second)]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
    assert.equal([financial(first.recordId),financial(second.recordId)].filter(Boolean).length,1);
    const exact=payment(id);const before=count('financial_records');const identical=await Promise.all([post(exact),post(exact)]);
    assert.deepEqual(identical.map(r=>r.status),[200,200]);assert.equal(count('financial_records'),before+1);
  });
  await group('racing payment and void CAS cannot mutate dependent records after zero-row inquiry update',async()=>{
    const incoming=payment(id);beforeBatch=()=>sqlite.prepare('UPDATE inquiries SET revision=? WHERE id=?').run(crypto.randomUUID(),id);
    assert.equal((await post(incoming)).status,409);assert.equal(financial(incoming.recordId),undefined);
    const saved=payment(id);assert.equal((await post(saved)).status,200);const before=financial(saved.recordId);
    beforeBatch=()=>sqlite.prepare('UPDATE inquiries SET revision=? WHERE id=?').run(crypto.randomUUID(),id);
    assert.equal((await voidRecord(id,saved.recordId)).status,409);assert.deepEqual(financial(saved.recordId),before);
  });
  await group('financial identity is inquiry-bound and reusable UUID race rolls back losing inquiry revision',async()=>{
    const other=await newInquiry();const old=payment(id);assert.equal((await post(old)).status,200);
    assert.equal((await post(payment(other,{recordId:old.recordId}))).status,409);assert.equal((await voidRecord(other,old.recordId)).status,404);
    const raceId=crypto.randomUUID(), before=rev(other);
    beforeBatch=()=>sqlite.prepare('INSERT INTO financial_records(id,inquiry_id,kind,amount_cents,paid_on,method,created_at,created_by) VALUES(?,?,?,?,?,?,?,?)').run(raceId,id,'payment',100,'2026-10-20','Cash','2026-10-22T12:00:00Z','fixture@example.test');
    assert.equal((await post(payment(other,{recordId:raceId}))).status,409);assert.equal(rev(other),before,'unique collision rolls back revision update');assert.equal(financial(raceId).inquiry_id,id);
  });
  await group('paid-on dates are strict Eastern calendar dates, no future dates or invalid method/type',async()=>{
    for(const paidOn of ['2026-10-23','2026-02-30','2026-1-01','2026-10-21T00:00:00Z','1899-12-31','bad']) assert.equal((await post(payment(id,{paidOn}))).status,400,paidOn);
    for(const method of ['venmo','Paypal','cash','Wire',null]) assert.equal((await post(payment(id,{method}))).status,400);
    for(const extra of [{kind:'deposit'},{createdBy:'spoof@example.test'},{amountCents:5},{recordId:'bad'}]) assert.equal((await post({...payment(id),...extra})).status,400);
    const response=await post(payment(id,{paidOn:'2026-10-22',method:'Other'}));assert.equal(response.status,200);
    assert.equal((await voidRecord(id,deposit.recordId,{reason:'\nBad reason'})).status,400);
    assert.equal((await voidRecord(id,deposit.recordId,{reason:'   '})).status,400);
  });
  await group('actual request bytes are bounded even with absent or misleading Content-Length',async()=>{
    const body=JSON.stringify({...payment(id),extra:'x'.repeat(24000)});
    for(const length of [undefined,'1']) {
      const headers={'Content-Type':'application/json',Origin:'https://test.local',...(length?{'Content-Length':length}:{})};
      assert.equal((await manage.POST(new Request('https://test.local/api/manage',{method:'POST',headers,body}))).status,413);
    }
    const huge=JSON.stringify({...valid,message:'x'.repeat(21000)});assert.equal((await lead.POST(req(JSON.parse(huge)))).status,413);
    const malformed=new Request('https://test.local/api/manage',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://test.local'},body:'{'});assert.equal((await manage.POST(malformed)).status,400);
  });
  await group('all financial data remains behind manager read transaction; public projection stays minimal',async()=>{
    const response=await manage.GET();assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/private.*no-store/);
    const data=await response.json();assert.equal(data.financialRecords.length,count('financial_records'));assert.equal(data.statusHistory.length,count('inquiry_status_history'));assert.equal(data.amountHistory.length,count('inquiry_amount_history'));
    const saved=data.inquiries.find(item=>item.id===id);assert.equal(saved.revision,rev(id));assert.equal(saved.referralSource,'Google');assert.equal(saved.bookedAmountCents,99999999);
    const publicRows=await (await pub.GET()).json();assert.deepEqual(publicRows,[]);
    manager=false;const before=databaseReads;assert.equal((await manage.GET()).status,403);assert.equal(databaseReads,before);manager=true;
  });
  await group('database failures return sanitized private no-store response and never partial records',async()=>{
    const healthy=db;db={batch:async()=>{throw new Error('SQL secret internal diagnostic');}};
    const response=await manage.GET();db=healthy;
    assert.equal(response.status,503);assert.match(response.headers.get('cache-control'),/private.*no-store/);
    const body=await response.text();assert.doesNotMatch(body,/SQL secret|inquiries|financialRecords/);assert.match(body,/temporarily unavailable/);
  });
  await group('legacy writers cannot change status without revision and audits cannot be rewritten or removed',async()=>{
    const original=inquiry(id),before=history(id);
    assert.throws(()=>sqlite.prepare('UPDATE inquiries SET status=? WHERE id=?').run('Canceled',id),/requires revision/);
    assert.deepEqual(inquiry(id),original);assert.deepEqual(history(id),before);
    assert.throws(()=>sqlite.prepare('UPDATE inquiry_status_history SET to_status=? WHERE inquiry_id=?').run('Canceled',id),/append-only/);
    assert.throws(()=>sqlite.prepare('DELETE FROM inquiry_status_history WHERE inquiry_id=?').run(id),/cannot be deleted/);
    assert.throws(()=>sqlite.prepare('UPDATE inquiry_amount_history SET to_booked_cents=1 WHERE inquiry_id=?').run(id),/append-only/);
    assert.throws(()=>sqlite.prepare('DELETE FROM inquiry_amount_history WHERE inquiry_id=?').run(id),/cannot be deleted/);
  });
  await group('persistent manager bookkeeping rate bound has no financial mutation after limit',async()=>{
    const base=payment(id);assert.equal((await post(base)).status,200);
    const minute=Math.floor(TestDate.now()/60000);
    sqlite.prepare('UPDATE finance_rate_limits SET count=60 WHERE key=?').run(managerEmail.toLowerCase()+':'+minute);
    const before=count('financial_records'),version=rev(id);const response=await post(payment(id));
    assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'60');assert.equal(count('financial_records'),before);assert.equal(rev(id),version);
  });
  sqlite.close();console.log(`Finance API checks passed: ${groups} groups; real local SQLite + Drizzle, synthetic records only.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
