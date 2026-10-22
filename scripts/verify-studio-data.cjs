/* Pure, deterministic Studio data/calendar tests. Synthetic fixtures only;
 * no network, browser, database, or production records. Re-run in real process
 * time zones so local-day/DST behavior is verified, not mocked away. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const ts = require('typescript');

if (!process.argv.includes('--zone')) {
  for (const zone of ['America/New_York', 'Pacific/Honolulu', 'UTC']) {
    const result = spawnSync(process.execPath, [__filename, '--zone'], { env: { ...process.env, TZ: zone }, encoding: 'utf8' });
    process.stdout.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `Studio data tests failed in ${zone}`);
  }
  console.log('Studio data verified in America/New_York, Pacific/Honolulu, and UTC.');
  process.exit(0);
}
const moduleObject = { exports: {} };
const source = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../app/studio/studio-data.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
vm.runInNewContext(source, { module: moduleObject, exports: moduleObject.exports, Date, URLSearchParams, Intl });
const { localDay, calendarDate, formatDay, addDays, shiftMonth, monthDays, dashboard, servicesLabel, parseStudioHash, calendarFile, blankEntry } = moduleObject.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const ids = values => Array.from(values, value => value.id);
let groups = 0;
function group(name, fn) { fn(); groups++; console.log(`✓ [${process.env.TZ}] ${name}`); }
const entry = (id, date, type = 'Private booking', extras = {}) => ({ id, title: 'Local test ' + id, date, start: '', end: '', venue: '', type, isPublic: false, facebook: '', notes: '', ...extras });
const inquiry = (id, status) => ({ id, name: 'Local QA', email: 'local@example.invalid', phone: '', date: '2026-10-22', venue: '', eventType: 'Wedding', guests: '', hours: '', services: '[]', message: '', createdAt: '2026-10-21T00:00:00Z', status });

group('local calendar day at UTC midnight never drops a US evening booking', () => {
  const moment = new Date('2026-10-23T00:15:00Z');
  const expected = process.env.TZ === 'UTC' ? '2026-10-23' : '2026-10-22';
  assert.equal(localDay(moment), expected);
  assert.equal(localDay(new Date(2026, 0, 2, 0, 0, 0)), '2026-01-02');
  if (process.env.TZ === 'Pacific/Honolulu') assert.equal(localDay(new Date('2026-10-23T09:59:59Z')), '2026-10-22');
  const result = dashboard([], [entry('tonight', expected)], localDay(moment));
  assert.equal(result.nextEvent.id, 'tonight');
});

group('real counts, stable event ordering, inclusive today, blocked next-event exclusion, seven days', () => {
  const events = [
    entry('eighth-day', '2026-10-29'),
    entry('public-tomorrow', '2026-10-23', 'Public appearance', { isPublic: true, start: '19:00' }),
    entry('past-public', '2026-10-21', 'Public appearance', { isPublic: true }),
    entry('today-b', '2026-10-22', 'Private booking', { start: '19:00' }),
    entry('today-block', '2026-10-22', 'Blocked date', { start: '08:00' }),
    entry('seventh-day', '2026-10-28', 'Public appearance', { isPublic: true }),
    entry('today-a', '2026-10-22', 'Private booking', { start: '19:00' }),
    entry('private-appearance', '2026-11-01', 'Public appearance', { isPublic: false }),
    entry('past-booking', '2026-10-20'),
  ];
  const inquiries = ['New', 'Contacted', 'New', 'Quote sent', 'Booked', 'Declined', 'Canceled', 'new', ' New'].map((status, index) => inquiry(String(index), status));
  const before = JSON.stringify(events);
  const result = dashboard(inquiries, events, '2026-10-22');
  assert.equal(result.newInquiries, 2, 'only exact New records count');
  assert.equal(result.upcomingBookings, 3, 'future/today Private booking entries only');
  assert.equal(result.publicAppearances, 2, 'future/today isPublic entries only');
  assert.deepEqual(ids(result.upcoming), ['today-block', 'today-a', 'today-b', 'public-tomorrow', 'seventh-day', 'eighth-day', 'private-appearance']);
  assert.equal(result.nextEvent.id, 'today-a', 'blocks are not announced as the next event');
  assert.deepEqual(ids(result.week), ['today-block', 'today-a', 'today-b', 'public-tomorrow', 'seventh-day']);
  assert.equal(JSON.stringify(events), before, 'dashboard sorting never mutates source events');
});

group('honest zero/empty states and all-blocked calendar', () => {
  const empty = dashboard([], [], '2026-10-22');
  assert.equal(empty.newInquiries, 0); assert.equal(empty.nextEvent, null);
  assert.equal(empty.upcomingBookings, 0); assert.equal(empty.publicAppearances, 0);
  assert.equal(empty.upcoming.length, 0); assert.equal(empty.week.length, 0);
  const blocked = dashboard([], [entry('block', '2026-10-22', 'Blocked date')], '2026-10-22');
  assert.equal(blocked.nextEvent, null); assert.equal(blocked.week.length, 1);
  assert.equal(blankEntry.isPublic, false, 'new entries are not public by default');
});

group('month grid, leap days, year transitions, and positive/negative month shifts', () => {
  const february = Array.from(monthDays('2024-02-17'));
  assert.equal(february.length, 42); assert.equal(new Set(february).size, 42);
  assert.equal(february[0], '2024-01-28'); assert.equal(february.at(-1), '2024-03-09');
  assert.equal(calendarDate(february[0]).getDay(), 0, 'grid starts Sunday');
  assert.ok(february.includes('2024-02-29')); assert.equal(february.filter(day => day.startsWith('2024-02')).length, 29);
  assert.equal(Array.from(monthDays('2026-02-01')).filter(day => day.startsWith('2026-02')).length, 28);
  assert.equal(shiftMonth('2026-01-31', 1), '2026-02-01', 'month navigation is anchored to first day');
  assert.equal(shiftMonth('2026-12-31', 1), '2027-01-01');
  assert.equal(shiftMonth('2026-01-01', -1), '2025-12-01');
  assert.equal(shiftMonth('2026-01-01', 12), '2027-01-01');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2024-02-29', 1), '2024-03-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});

group('day arithmetic stays calendar-based across US DST and preserves local noon', () => {
  for (const [start, end] of [['2026-03-07', '2026-03-08'], ['2026-03-08', '2026-03-09'], ['2026-10-31', '2026-11-01'], ['2026-11-01', '2026-11-02']]) {
    assert.equal(addDays(start, 1), end); assert.equal(addDays(end, -1), start);
    assert.equal(calendarDate(start).getHours(), 12); assert.equal(calendarDate(end).getHours(), 12);
  }
  if (process.env.TZ === 'America/New_York') {
    assert.equal((calendarDate('2026-03-08') - calendarDate('2026-03-07')) / 3600000, 23);
    assert.equal((calendarDate('2026-11-01') - calendarDate('2026-10-31')) / 3600000, 25);
  }
  assert.equal(formatDay('2024-02-29'), 'February 29, 2024');
  assert.equal(formatDay('not-a-date'), 'Date unavailable');
});

group('hash parsing accepts only Studio views and decodes event IDs', () => {
  for (const view of ['deck', 'bookings', 'calendar', 'voices', 'settings', 'add-date']) assert.deepEqual(plain(parseStudioHash('#' + view)), { view, event: null });
  for (const invalid of ['', '#', '#unknown', '#https://other.example', '#<script>']) assert.equal(parseStudioHash(invalid).view, 'deck');
  assert.deepEqual(plain(parseStudioHash('#calendar?event=booking%2Dlocal%2F1%20two')), { view: 'calendar', event: 'booking-local/1 two' });
  assert.deepEqual(plain(parseStudioHash('bookings?filter=New')), { view: 'bookings', event: null });
});

group('services labels tolerate corrupted/mixed legacy JSON without throwing', () => {
  assert.equal(servicesLabel('["DJ service","MC services"]'), 'DJ service + MC services');
  assert.equal(servicesLabel('[1,null,{"x":1},true,"DJ service"]'), 'DJ service');
  assert.equal(servicesLabel('[]'), '');
  for (const value of ['', '{', 'null', '17', 'true', '"string"', '{"service":"DJ"}']) assert.equal(servicesLabel(value), 'Services unavailable');
  assert.equal(servicesLabel('["<script>alert(1)</script>"]'), '<script>alert(1)</script>', 'helper returns plain text for React to escape, never HTML');
});

group('ICS all-day dates, exclusive end, stable timestamp, and text escaping', () => {
  const event = entry('local,one;two\\id', '2024-02-29', 'Private booking', {
    title: 'Local, test; \\ title\r\nBEGIN:INJECTED',
    venue: 'Room, A; North\\South', start: '18:00', end: '23:00',
    notes: 'Line one\nLine two, semi; slash\\\r', facebook: 'https://www.facebook.com/events/local-test',
  });
  const ics = calendarFile(event, new Date('2026-10-22T13:00:01.234Z'));
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(ics.endsWith('END:VEVENT\r\nEND:VCALENDAR'));
  const lines = ics.split('\r\n');
  assert.ok(lines.includes('DTSTAMP:20261022T130001Z'));
  assert.ok(lines.includes('DTSTART;VALUE=DATE:20240229'));
  assert.ok(lines.includes('DTEND;VALUE=DATE:20240301'));
  assert.ok(lines.includes('UID:local\\,one\\;two\\\\id@djzachb'));
  assert.ok(lines.includes('SUMMARY:Local\\, test\\; \\\\ title\\nBEGIN:INJECTED'));
  assert.ok(lines.includes('LOCATION:Room\\, A\\; North\\\\South'));
  assert.ok(lines.includes('DESCRIPTION:Time: 18:00 – 23:00\\nLine one\\nLine two\\, semi\\; slash\\\\\\nhttps://www.facebook.com/events/local-test'));
  assert.ok(!lines.includes('BEGIN:INJECTED'), 'untrusted newlines cannot add ICS properties');
  assert.doesNotMatch(ics, /(?<!\r)\n|\r(?!\n)/, 'calendar lines use CRLF only');
  for (const day of ['2026-03-08', '2026-11-01', '2026-12-31']) {
    const output = calendarFile(entry('day', day), new Date('2026-01-01T00:00:00Z'));
    assert.ok(output.includes('DTSTART;VALUE=DATE:' + day.replaceAll('-', '')));
    assert.ok(output.includes('DTEND;VALUE=DATE:' + addDays(day, 1).replaceAll('-', '')));
  }
});
console.log(`Studio data: ${groups} groups passed in ${process.env.TZ}.`);
