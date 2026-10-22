// Actual React component and private page guard. Synthetic in-memory fixtures;
// no network, real customer records, browser session, database, or writes.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');
function transpile(file) { return ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText; }
const contract = { exports: {} };
vm.runInNewContext(transpile('app/booking-finance-contract.ts'), { module: contract, exports: contract.exports, Date, Intl });
const metrics = { exports: {} };
vm.runInNewContext(transpile('app/studio/business-snapshot-data.ts'), { module: metrics, exports: metrics.exports, Date, Intl, require: name => name === '../booking-finance-contract' ? contract.exports : require(name) });
const component = { exports: {} };
vm.runInNewContext(transpile('app/studio/business-snapshot.tsx'), { module: component, exports: component.exports, Date, Intl, require: name => name === './business-snapshot-data' ? metrics.exports : name.endsWith('.css') ? {} : require(name) });
const Snapshot = component.exports.default;
const elements = (node, test) => Array.isArray(node) ? node.flatMap(child => elements(child, test)) : !node || typeof node !== 'object' || !node.props ? [] : [...(test(node) ? [node] : []), ...elements(node.props.children, test)];
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node == null || typeof node === 'boolean' ? '' : String(node);
const inquiry = (id, createdAt, status = 'New', extra = {}) => ({ id, name: 'Sensitive client <script>name</script>', email: 'private-client@example.invalid', phone: '555-0101', date: '2027-06-10', venue: 'Secret venue', eventType: 'Wedding', guests: '80', hours: '18:00', services: '["Secret services"]', message: 'Private message', createdAt, status, ...extra });
const event = (id, extra = {}) => ({ id, title: 'Secret event', date: '2027-06-10', start: '', end: '', venue: 'Secret venue', type: 'Private booking', isPublic: false, facebook: '', notes: 'Private notes', servicePlan: 'Private plan', contactName: 'Private contact', contactEmail: 'private-contact@example.invalid', contactPhone: '555-0100', revision: 'Private revision', ...extra });
const props = { inquiries: [], events: [], financialRecords: [], asOf: '2026-10-22T15:00:00Z', loading: false, hasLoaded: true, onReviewNew() {} };
function markup(overrides = {}) { return renderToStaticMarkup(Snapshot({ ...props, ...overrides })); }
let groups = 0;
function group(name, fn) { fn(); groups++; console.log('✓ ' + name); }

group('loading, unavailable and invalid refresh states never masquerade as real zeroes', () => {
  const privateRows = [inquiry('private', '2026-10-10T12:00:00Z')];
  const loading = markup({ loading: true, inquiries: privateRows, events: [event('private')] });
  assert.match(loading, /Gathering your snapshot/); assert.match(loading, /aria-busy="true"/);
  assert.doesNotMatch(loading, /snapshot-metric|Website inquiries|private-client/);
  for (const unavailable of [{ hasLoaded: false }, { asOf: null }, { asOf: 'invalid' }]) {
    const html = markup({ inquiries: privateRows, ...unavailable });
    assert.match(html, /Your snapshot is unavailable/); assert.doesNotMatch(html, /snapshot-metric|private-client/);
  }
});
group('empty snapshot has honest zero counts, no bogus rate and explicit missing integrations', () => {
  const html = markup();
  assert.match(html, /Sep 22, 2026 – Oct 21, 2026/); assert.match(html, /Aug 23, 2026 – Sep 21, 2026/);
  assert.match(html, /No inquiries in this window, so there is no rate yet/); assert.match(html, /Prior window: no inquiries to compare/);
  assert.match(html, /<strong>—<\/strong>/); assert.doesNotMatch(html, /NaN|Infinity|<strong>0%/);
  for (const phrase of ['Not connected', 'Not available yet', 'A booking is not cash received', 'True ROI needs attributed revenue and costs', 'not unique people', 'Today is not included']) assert.ok(html.includes(phrase), phrase);
  assert.doesNotMatch(html, /<strong>0 visits|Connect analytics<\/button>/);
});
group('actual cards reflect received cohorts, current status, separate calendar dates and TEST exclusions', () => {
  const inquiries = [inquiry('booked', '2026-10-10T12:00:00Z', 'Booked'), inquiry('new', '2026-10-13T12:00:00Z'), inquiry('canceled', '2026-10-14T12:00:00Z', 'Canceled'), inquiry('prior', '2026-09-10T12:00:00Z', 'Booked'), inquiry('today', '2026-10-22T12:00:00Z'), inquiry('training', '2026-10-10T12:00:00Z', 'Booked', { name: 'TEST ONLY 20261022-I1 — Training', email: 'training@example.test' })];
  const events = [event('booking-booked'), event('manual'), event('booking-training', { contactName: 'Renamed', contactEmail: 'changed@example.invalid' }), event('public', { type: 'Public appearance' }), event('blocked', { type: 'Blocked date' })];
  const tree = Snapshot({ ...props, inquiries, events });
  const cards = elements(tree, node => node.type === 'article' && node.props.className?.includes('snapshot-metric'));
  assert.equal(cards.length, 4);
  assert.match(text(cards[0]), /Website inquiries32 more than prior 30 days \(1\)/);
  assert.match(text(cards[1]), /Booked from these inquiries11 currently Booked/);
  assert.match(text(cards[2]), /Inquiry → booking33.3%/);
  assert.match(text(cards[3]), /Awaiting first follow-up21 received 7\+ calendar days ago/);
  const html = renderToStaticMarkup(tree);
  assert.match(html, /2 upcoming private bookings/); assert.match(html, /Added directly to Calendar<\/dt><dd>1/);
  assert.match(html, /1 known TEST inquiries and 1 known TEST calendar entries excluded/);
  assert.match(html, /Not bookings made during the window/); assert.match(html, /Recent inquiries have had less time to book/);
  for (const privateText of ['Sensitive client', 'private-client', '555-0101', 'Secret venue', 'Secret event', 'Private notes', 'Private plan', 'Private contact', 'Private revision', 'TEST ONLY 20261022-I1']) assert.ok(!html.includes(privateText), privateText + ' must not be rendered');
  assert.match(html, /role="img" aria-label="Website inquiries by received month/); assert.match(html, /October 2026: 4 \(month to date\)/);
  assert.match(html, /Current month through the last refresh; not a full-month comparison/);
});
group('follow-up action is read-only and routes to the existing New inquiry list', () => {
  let calls = 0;
  const tree = Snapshot({ ...props, onReviewNew() { calls++; } });
  const link = elements(tree, node => node.type === 'a' && node.props.href === '#bookings');
  assert.equal(link.length, 1); link[0].props.onClick(); assert.equal(calls, 1);
  assert.equal(elements(tree, node => node.type === 'form' || node.type === 'button').length, 0);
  assert.ok(elements(tree, node => node.type === 'a' && node.props.href === '#calendar').length);
});
group('date-quality caveats and TEST-only empty snapshot remain explicit', () => {
  const html = markup({ inquiries: [inquiry('invalid', '2026-10-15'), inquiry('future', '2026-10-23T12:00:00Z')], events: [event('invalid-event', { date: '2026-02-30' })] });
  assert.match(html, /1 inquiries have invalid or ambiguous received timestamps and 1 have future/);
  assert.match(html, /2 New inquiries have an unknown or future received time/);
  assert.match(html, /1 calendar entries have invalid dates/);
  const testsOnly = markup({ inquiries: [inquiry('test', '2026-10-10T12:00:00Z', 'New', { email: 'fixture@example.test' })], events: [event('booking-test')] });
  assert.match(testsOnly, /No inquiries in this window/); assert.match(testsOnly, /1 known TEST inquiries and 1 known TEST calendar entries excluded/);
});

group('financial cards distinguish known value coverage from manually dated received money without exposing audit details', () => {
  const html = markup({
    inquiries: [inquiry('booked', '2025-01-01T12:00:00Z', 'Booked', { bookedAmountCents: 150_000 }), inquiry('unknown', '2026-10-10T12:00:00Z', 'Booked'), inquiry('zero', '2026-10-10T12:00:00Z', 'Booked', { bookedAmountCents: 0 }), inquiry('canceled', '2025-01-01T12:00:00Z', 'Canceled')],
    financialRecords: [
      { id: 'private-payment', inquiryId: 'canceled', kind: 'payment', amountCents: 50_000, paidOn: '2026-10-10', voidedAt: null, createdBy: 'SECRET OWNER', method: 'Cash' },
      { id: 'private-refund', inquiryId: 'canceled', kind: 'refund', amountCents: 20_000, paidOn: '2026-10-11', voidedAt: null, voidReason: 'SECRET REASON' },
      { id: 'private-void', inquiryId: 'booked', kind: 'payment', amountCents: 15_000, paidOn: '2026-10-10', voidedAt: '2026-10-22T12:00:00Z' },
    ],
  });
  for (const phrase of ['Known agreed booking value', '$1,500.00', '2 of 3 currently Booked inquiries have an amount. 1 unknown.', 'Unknown amounts are not treated as zero', 'Net recorded received', '$300.00', '$500.00', '$200.00', '1 payment entry and 1 refund entry', 'This is not a 30-day sales total', 'not profit or ROI', 'Canceled-booking records remain included', '1 voided financial entries excluded']) assert.ok(html.includes(phrase), phrase);
  assert.doesNotMatch(html, /SECRET|private-payment|private-refund|private-void/);
  assert.doesNotMatch(html, /Booking amounts and collected payments are not recorded|no booking-status history exists/);
  assert.match(html, /Only actual status changes are tracked going forward/);
  assert.match(html, /Older booking-confirmation dates are Not recorded; this view does not count newly confirmed bookings by period/);
});
group('unknown money is unavailable, explicit zero is money, and discovery only renders bounded categories', () => {
  const unknown = markup({ inquiries: [inquiry('unknown', '2026-10-10T12:00:00Z', 'Booked')] });
  assert.match(unknown, /No agreed booking amounts are available/);
  assert.match(unknown, /0 of 1 currently Booked inquiries have an amount. 1 unknown/);
  const html = markup({ inquiries: [inquiry('zero', '2026-10-10T12:00:00Z', 'Booked', { bookedAmountCents: 0, referralSource: 'Other', referralOther: 'SECRET SOURCE' })] });
  assert.match(html, /class="snapshot-money">\$0.00/);
  assert.match(html, /1 of 1 inquiries received Sep 22, 2026 – Oct 21, 2026 supplied a discovery source. 0 unknown/);
  assert.match(html, /Other<\/dt><dd>1/); assert.match(html, /Unknown \/ not provided<\/dt><dd>0/);
  assert.doesNotMatch(html, /SECRET SOURCE/);
  assert.match(html, /Older records stay unknown/); assert.match(html, /Manual calendar-only bookings have no financial records/);
});
group('invalid and orphan financial data is explained instead of silently appearing in totals', () => {
  const html = markup({ inquiries: [inquiry('bad', '2026-10-10T12:00:00Z', 'Booked', { bookedAmountCents: -1 })], financialRecords: [
    { id: 'bad', inquiryId: 'bad', kind: 'payment', amountCents: -1, paidOn: '2026-10-10', voidedAt: null },
    { id: 'orphan', inquiryId: 'missing', kind: 'payment', amountCents: 100, paidOn: '2026-10-10', voidedAt: null },
    { id: 'future', inquiryId: 'bad', kind: 'payment', amountCents: 100, paidOn: '2026-10-23', voidedAt: null },
  ] });
  assert.match(html, /Financial data check: 1 invalid booked amounts treated as unknown; 1 unlinked, 1 invalid, 1 future-dated, and 0 duplicate financial entries excluded/);
});

(async () => {
  let authorized = false;
  function PrivateStudio() { return require('react').createElement('div', null, 'PRIVATE SNAPSHOT SENTINEL'); }
  const page = { exports: {} };
  vm.runInNewContext(transpile('app/studio/page.tsx'), { module: page, exports: page.exports, require: name => name === '../cloudflare-auth' ? { getManagerAuthResult: async () => ({ user: authorized ? { email: 'fixture@example.invalid' } : null, code: 'LOCAL_FIXTURE' }) } : name === './studio' ? { __esModule: true, default: PrivateStudio } : require(name) });
  const denied = renderToStaticMarkup(await page.exports.default());
  assert.match(denied, /Studio access/); assert.doesNotMatch(denied, /PRIVATE SNAPSHOT SENTINEL/);
  authorized = true;
  assert.match(renderToStaticMarkup(await page.exports.default()), /PRIVATE SNAPSHOT SENTINEL/);
  assert.equal(page.exports.dynamic, 'force-dynamic');
  console.log(`Business Snapshot UI: ${groups} fixture groups plus actual private page guard passed. Browser rendering is not covered by this suite.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
