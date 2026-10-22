/* Pure Business Snapshot checks; synthetic fixtures only. The business time zone
 * is fixed even when Studio is opened by an owner traveling in another zone. */
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict'), { spawnSync } = require('node:child_process');
const ts = require('typescript');

if (!process.argv.includes('--zone')) {
  for (const zone of ['America/New_York', 'Pacific/Honolulu', 'UTC']) {
    const result = spawnSync(process.execPath, [__filename, '--zone'], { env: { ...process.env, TZ: zone }, encoding: 'utf8' });
    process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `Business Snapshot failed in ${zone}`);
  }
  console.log('Business Snapshot data verified in New York, Honolulu, and UTC.');
  process.exit(0);
}
const mod = { exports: {} };
const source = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../app/studio/business-snapshot-data.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
vm.runInNewContext(source, { module: mod, exports: mod.exports, Date, Intl });
const { businessSnapshot, BUSINESS_TIME_ZONE } = mod.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const now = new Date('2026-10-22T14:00:00Z');
const inquiry = (id, createdAt = '2026-10-12T12:00:00Z', status = 'New', extras = {}) => ({ id, name: 'Fictional customer ' + id, email: 'customer@example.invalid', phone: '5550100', date: '2027-04-20', venue: 'Fictional venue', eventType: 'Wedding', guests: '80', hours: '5', services: '[]', message: '', status, createdAt, ...extras });
const entry = (id, date = '2027-04-20', extras = {}) => ({ id, title: 'Fictional booking ' + id, date, start: '', end: '', venue: '', type: 'Private booking', isPublic: false, facebook: '', notes: '', servicePlan: null, contactName: null, contactEmail: null, contactPhone: null, revision: 'legacy', ...extras });
const snapshot = (inquiries = [], events = [], at = now) => businessSnapshot(inquiries, events, at);
let groups = 0;
function group(name, fn) { fn(); groups++; console.log(`✓ [${process.env.TZ}] ${name}`); }

group('complete 30-day New York windows are independent of browser time zone', () => {
  assert.equal(BUSINESS_TIME_ZONE, 'America/New_York');
  assert.deepEqual(plain(snapshot().windows), { today: '2026-10-22', currentStart: '2026-09-22', currentEnd: '2026-10-21', priorStart: '2026-08-23', priorEnd: '2026-09-21' });
  assert.deepEqual(plain(snapshot([], [], new Date('2026-10-23T00:15:00Z')).windows), plain(snapshot().windows), 'UTC midnight is still the previous New York day');
  assert.equal(snapshot([], [], new Date('2026-10-23T04:00:00Z')).windows.today, '2026-10-23');
});

group('both cohort boundaries are inclusive, with today and older records excluded', () => {
  const rows = [
    inquiry('older', '2026-08-23T03:59:59.999Z', 'Booked'),
    inquiry('prior-start', '2026-08-23T04:00:00.000Z', 'New'),
    inquiry('prior-end', '2026-09-22T03:59:59.999Z', 'Booked'),
    inquiry('current-start', '2026-09-22T04:00:00.000Z', 'Booked'),
    inquiry('current-end', '2026-10-22T03:59:59.999Z', 'New'),
    inquiry('current-offset', '2026-10-21T23:59:59-04:00', 'Booked'),
    inquiry('today', '2026-10-22T04:00:00.000Z', 'Booked'),
  ];
  const result = snapshot(rows);
  assert.deepEqual(plain(result.current), { inquiries: 3, booked: 2, conversionRate: 2 / 3 * 100 });
  assert.deepEqual(plain(result.prior), { inquiries: 2, booked: 1, conversionRate: 50 });
  assert.equal(result.trend.at(-1).inquiries, 3, 'partial monthly trend includes today through refresh');
});

group('conversion measures current status within inquiry-created cohorts, never event dates', () => {
  const statuses = ['New', 'Contacted', 'Quote sent', 'Booked', 'Declined', 'Canceled', 'booked', ' Booked'];
  const rows = statuses.map((status, i) => inquiry('current-' + i, '2026-10-12T12:00:00Z', status, { date: i % 2 ? '2024-01-01' : '2029-01-01' }));
  rows.push(inquiry('old-booked', '2026-01-01T12:00:00Z', 'Booked', { date: '2026-10-12' }));
  const result = snapshot(rows, [entry('manual'), entry('booking-old-booked')]);
  assert.deepEqual(plain(result.current), { inquiries: 8, booked: 1, conversionRate: 12.5 });
  assert.deepEqual(plain(result.upcomingBookings), { total: 2, linked: 1, manual: 1 });
  assert.equal(result.followUps.newInquiries, 1);
  assert.equal(snapshot(rows.map(row => row.id === 'current-3' ? { ...row, status: 'Canceled' } : row)).current.booked, 0, 'canceled is not still booked');
  assert.equal(snapshot(rows).current.booked, 1, 'an inquiry status does not require an event date in the cohort');
});

group('zero denominator is unavailable, not a fabricated zero or percent change', () => {
  const empty = snapshot();
  assert.deepEqual(plain(empty.current), { inquiries: 0, booked: 0, conversionRate: null });
  assert.deepEqual(plain(empty.prior), { inquiries: 0, booked: 0, conversionRate: null });
  assert.deepEqual(plain(empty.followUps), { newInquiries: 0, agedSevenDays: 0, oldestAgeDays: null, unknownAgeCount: 0 });
  assert.deepEqual(plain(empty.upcomingBookings), { total: 0, linked: 0, manual: 0 });
  assert.equal(snapshot([inquiry('new')]).current.conversionRate, 0, 'zero booked out of a real nonzero cohort is genuinely zero');
  assert.equal(snapshot([inquiry('booked', undefined, 'Booked')]).current.conversionRate, 100);
  assert.equal(empty.trend.length, 6); assert(empty.trend.every(row => row.inquiries === 0));
  assert.throws(() => snapshot([], [], new Date('invalid')), /valid refresh time/);
});

group('spring and fall DST transitions retain exact complete local calendar-day boundaries', () => {
  const spring = snapshot([
    inquiry('prior-spring', '2026-02-07T04:59:59.999Z'),
    inquiry('first-spring', '2026-02-07T05:00:00Z'),
    inquiry('last-spring', '2026-03-09T03:59:59.999Z'),
    inquiry('today-spring', '2026-03-09T04:00:00Z'),
  ], [], new Date('2026-03-09T14:00:00Z'));
  assert.deepEqual(plain(spring.windows), { today: '2026-03-09', currentStart: '2026-02-07', currentEnd: '2026-03-08', priorStart: '2026-01-08', priorEnd: '2026-02-06' });
  assert.equal(spring.current.inquiries, 2); assert.equal(spring.prior.inquiries, 1);
  const fall = snapshot([
    inquiry('prior-fall', '2026-10-03T03:59:59.999Z'),
    inquiry('first-fall', '2026-10-03T04:00:00Z'),
    inquiry('last-fall', '2026-11-02T04:59:59.999Z'),
    inquiry('today-fall', '2026-11-02T05:00:00Z'),
  ], [], new Date('2026-11-02T15:00:00Z'));
  assert.equal(fall.windows.currentStart, '2026-10-03'); assert.equal(fall.windows.currentEnd, '2026-11-01');
  assert.equal(fall.current.inquiries, 2); assert.equal(fall.prior.inquiries, 1);
});

group('month, year, and leap-day arithmetic retains calendar dates and six ordered months', () => {
  const year = snapshot([], [], new Date('2027-01-01T05:00:00Z'));
  assert.deepEqual(plain(year.windows), { today: '2027-01-01', currentStart: '2026-12-02', currentEnd: '2026-12-31', priorStart: '2026-11-02', priorEnd: '2026-12-01' });
  assert.deepEqual(Array.from(year.trend, row => row.month), ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01']);
  assert.deepEqual(Array.from(year.trend, row => row.partial), [false, false, false, false, false, true]);
  const leap = snapshot([inquiry('leap', '2024-02-29T23:00:00Z'), inquiry('today-leap', '2024-03-01T05:00:00Z')], [], new Date('2024-03-01T12:00:00Z'));
  assert.equal(leap.windows.currentStart, '2024-01-31'); assert.equal(leap.windows.currentEnd, '2024-02-29');
  assert.equal(leap.current.inquiries, 1); assert.equal(leap.trend.find(row => row.month === '2024-02').inquiries, 1);
  assert.equal(leap.trend.at(-1).inquiries, 1);
});

group('follow-up is current New inventory with calendar-day ages, not historical contact claims', () => {
  const result = snapshot([
    inquiry('today', '2026-10-22T05:00:00Z'), inquiry('six', '2026-10-16T12:00:00Z'),
    inquiry('seven', '2026-10-15T12:00:00Z'), inquiry('old-new', '2026-07-01T12:00:00Z'),
    inquiry('contacted', '2026-01-01T12:00:00Z', 'Contacted'), inquiry('invalid', 'no timestamp'),
    inquiry('future', '2026-10-22T15:00:00Z'),
  ]);
  assert.deepEqual(plain(result.followUps), { newInquiries: 6, agedSevenDays: 2, oldestAgeDays: 113, unknownAgeCount: 2 });
  const spring = snapshot([inquiry('spring', '2026-03-08T05:00:00Z')], [], new Date('2026-03-15T04:00:00Z'));
  const fall = snapshot([inquiry('fall', '2026-11-01T04:00:00Z')], [], new Date('2026-11-08T05:00:00Z'));
  assert.equal(spring.followUps.oldestAgeDays, 7); assert.equal(spring.followUps.agedSevenDays, 1, '167 elapsed hours is seven local calendar dates');
  assert.equal(fall.followUps.oldestAgeDays, 7); assert.equal(fall.followUps.agedSevenDays, 1, '169 elapsed hours is also seven local calendar dates');
});

group('invalid, ambiguous, rollover, and future createdAt values are explicitly omitted from time metrics', () => {
  const invalid = ['', 'not-a-date', '2026-10-12', '2026-10-12T12:00:00', '2026-02-30T12:00:00Z', '2026-10-12T24:00:00Z', '2026-10-12T12:60:00Z', '2026-10-12T12:00:60Z', '2026-10-12T12:00:00+24:00'];
  const result = snapshot(invalid.map((date, index) => inquiry('invalid-' + index, date, 'Booked')).concat([
    inquiry('future-day', '2026-10-23T12:00:00Z', 'Booked'),
    inquiry('future-hour', '2026-10-22T14:00:00.001Z', 'Booked'),
    inquiry('exact-now', now.toISOString(), 'New'),
    inquiry('valid-offset', '2026-10-12T19:00:00+07:00', 'Booked'),
  ]));
  assert.equal(result.invalidCreatedAtCount, invalid.length); assert.equal(result.futureCreatedAtCount, 2);
  assert.deepEqual(plain(result.current), { inquiries: 1, booked: 1, conversionRate: 100 });
  assert.equal(result.trend.at(-1).inquiries, 2); assert.equal(result.followUps.unknownAgeCount, 0);
  assert.equal(snapshot([inquiry('bad-leap', '2025-02-29T12:00:00Z')]).invalidCreatedAtCount, 1);
});

group('known TEST markers and reserved exact email domain are excluded without name-substring false positives', () => {
  const excluded = [
    inquiry('training-i', undefined, 'New', { name: 'TEST ONLY 20261022-I1 — Alex Example' }),
    inquiry('training-t', undefined, 'Booked', { name: ' test only 20261022-t2 Jordan Example ' }),
    inquiry('training-e', undefined, 'New', { name: 'TEST ONLY 20261022-E3' }),
    inquiry('legacy', undefined, 'New', { name: ' TEST Deployment Check ' }),
    inquiry('reserved', undefined, 'Booked', { email: ' SAMPLE@EXAMPLE.TEST ' }),
  ];
  const legitimate = [
    inquiry('testa', undefined, 'New', { name: 'Testa Family' }),
    inquiry('contest', undefined, 'New', { name: 'Contest Events' }),
    inquiry('not-marker', undefined, 'New', { name: 'TEST ONLY 20261022-I1A' }),
    inquiry('not-exact', undefined, 'New', { name: 'TEST Deployment Checker' }),
    inquiry('not-domain', undefined, 'New', { email: 'customer@example.test.evil' }),
    inquiry('not-domain-prefix', undefined, 'New', { email: 'customer@notexample.test' }),
    inquiry('not-domain-subdomain', undefined, 'New', { email: 'customer@sub.example.test' }),
  ];
  const result = snapshot([...excluded, ...legitimate]);
  assert.equal(result.excludedInquiryCount, 5); assert.equal(result.current.inquiries, 7);
  assert.equal(result.current.booked, 0); assert.equal(result.followUps.newInquiries, 7);
  assert.equal(result.trend.at(-1).inquiries, 7);
});

group('TEST calendar entries remain excluded after a linked training inquiry is renamed in its event', () => {
  const rows = [inquiry('training', undefined, 'Booked', { email: 'training@example.test' }), inquiry('real', undefined, 'Booked')];
  const events = [
    entry('booking-training', undefined, { title: 'Renamed calendar event', contactName: 'New contact', contactEmail: 'new@example.invalid' }),
    entry('marked-title', undefined, { title: 'TEST ONLY 20261022-E1 — Training' }),
    entry('marked-contact', undefined, { contactName: 'TEST Deployment Check' }),
    entry('marked-email', undefined, { contactEmail: 'TRAINING@EXAMPLE.TEST' }),
    entry('booking-real'), entry('manual-real'), entry('booking-unknown'),
    entry('legitimate-name', undefined, { title: 'Testa celebration' }),
  ];
  const result = snapshot(rows, events);
  assert.equal(result.excludedInquiryCount, 1); assert.equal(result.excludedEventCount, 4);
  assert.deepEqual(plain(result.upcomingBookings), { total: 4, linked: 2, manual: 2 });
  assert.equal(result.current.inquiries, 1); assert.equal(result.current.booked, 1);
});

group('upcoming schedule includes today but not past, blocked/public types, or malformed dates', () => {
  const result = snapshot([], [
    entry('today', '2026-10-22'), entry('tomorrow', '2026-10-23'), entry('past', '2026-10-21'),
    entry('public', '2026-10-23', { type: 'Public appearance', isPublic: true }),
    entry('blocked', '2026-10-24', { type: 'Blocked date' }),
    entry('bad-rollover', '2027-02-30'), entry('bad-format', '2026-1-1'), entry('bad-time', '2027-01-01T00:00:00Z'),
  ]);
  assert.deepEqual(plain(result.upcomingBookings), { total: 2, linked: 0, manual: 2 });
  assert.equal(result.invalidEventDateCount, 3);
  const atMidnightUtc = snapshot([], [entry('tonight', '2026-10-22')], new Date('2026-10-23T00:15:00Z'));
  assert.equal(atMidnightUtc.upcomingBookings.total, 1, 'New York tonight is not dropped at UTC midnight');
});

group('projection never mutates source data or returns identifying/contact fields', () => {
  const rows = [inquiry('SECRET ID', undefined, 'New', { name: 'SECRET NAME', email: 'secret@example.invalid', message: 'SECRET MESSAGE' })];
  const events = [entry('SECRET EVENT ID', undefined, { title: 'SECRET TITLE', contactEmail: 'secret-contact@example.invalid', notes: 'SECRET NOTES' })];
  const before = JSON.stringify({ rows, events, now });
  rows.forEach(Object.freeze); events.forEach(Object.freeze); Object.freeze(rows); Object.freeze(events);
  const result = snapshot(rows, events);
  assert.equal(JSON.stringify({ rows, events, now }), before);
  assert.doesNotMatch(JSON.stringify(result), /SECRET|secret@|secret-contact/);
  assert.deepEqual(Object.keys(result).sort(), ['windows', 'current', 'prior', 'trend', 'followUps', 'upcomingBookings', 'excludedInquiryCount', 'excludedEventCount', 'invalidCreatedAtCount', 'futureCreatedAtCount', 'invalidEventDateCount'].sort());
});

console.log(`Business Snapshot data: ${groups} groups passed in ${process.env.TZ}.`);
