// Pure contract checks: no database, provider request, or real customer records.
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const mod = { exports: {} };
vm.runInNewContext(ts.transpileModule(fs.readFileSync('app/booking-finance-contract.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { module: mod, exports: mod.exports, Date, Intl });
const { parseUsdAmount, amountInput, formatUsd, businessToday, financeTotals, MAX_AMOUNT_CENTS } = mod.exports;
const expected = { '0': 0, '0.0': 0, '0.00': 0, '0.01': 1, '1': 100, '1.1': 110, '1.01': 101, '12.34': 1234, '999999.99': MAX_AMOUNT_CENTS };
for (const [value, cents] of Object.entries(expected)) assert.equal(parseUsdAmount(value), cents, value);
for (const value of ['', ' ', ' 1', '1 ', '-0', '-1', '-0.01', '+1', 'NaN', 'Infinity', '1e2', '1E-2', '0x10', '.5', '1.', '1.000', '1.001', '0.001', '000', '01', '$12', '1,000', '1_000', '1000000', '999999.999', '1\n', '1\0', '１', '١', null, undefined, 1, NaN, Infinity, {}, []]) assert.equal(parseUsdAmount(value), null, 'invalid decimal ' + String(value));
// Deterministic exact-cent round trips, independently computed with BigInt.
let seed = 0x462781;
for (let index = 0; index < 25000; index++) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  const cents = seed % (MAX_AMOUNT_CENTS + 1);
  const value = `${BigInt(cents) / 100n}.${String(BigInt(cents) % 100n).padStart(2, '0')}`;
  assert.equal(amountInput(cents), value);
  assert.equal(parseUsdAmount(value), cents);
  assert.equal(parseUsdAmount(value + '1'), null, 'excess precision cannot round money');
}
assert.equal(amountInput(null), ''); assert.equal(amountInput(undefined), ''); assert.equal(amountInput(0), '0.00');
assert.equal(formatUsd(null), 'Not recorded'); assert.equal(formatUsd(0), '$0.00'); assert.equal(formatUsd(10001), '$100.01');
for (const [instant, day] of [
  ['2026-10-23T03:59:59.999Z', '2026-10-22'], ['2026-10-23T04:00:00Z', '2026-10-23'],
  ['2026-03-08T04:59:59Z', '2026-03-07'], ['2026-03-08T05:00:00Z', '2026-03-08'],
  ['2026-03-09T03:59:59Z', '2026-03-08'], ['2026-03-09T04:00:00Z', '2026-03-09'],
  ['2026-11-01T03:59:59Z', '2026-10-31'], ['2026-11-01T04:00:00Z', '2026-11-01'],
  ['2026-11-02T04:59:59Z', '2026-11-01'], ['2026-11-02T05:00:00Z', '2026-11-02'],
]) assert.equal(businessToday(new Date(instant)), day, instant);
const records = [{ kind: 'payment', amountCents: 50000, voidedAt: null }, { kind: 'payment', amountCents: 25000, voidedAt: null }, { kind: 'refund', amountCents: 5000, voidedAt: null }, { kind: 'payment', amountCents: 99000, voidedAt: '2026-10-22T12:00:00Z' }, { kind: 'refund', amountCents: 1000, voidedAt: '2026-10-22T12:00:00Z' }];
const original = JSON.stringify(records);
assert.equal(JSON.stringify(financeTotals(records)), JSON.stringify({ paymentsCents: 75000, refundsCents: 5000, netReceivedCents: 70000 }));
assert.equal(JSON.stringify(records), original, 'projection is read-only');
assert.equal(financeTotals([]).netReceivedCents, 0);
console.log('Finance contract: 25,000 exact-cent property checks, invalid inputs/null/zero, DST calendar dates, and void-aware sums passed.');
