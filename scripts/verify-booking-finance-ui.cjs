// Actual Studio handlers and finance components with isolated local fixtures.
// No browser, Cloudflare session, database, payment processor, or real writes.
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const assert = require('node:assert/strict');
const { renderToStaticMarkup } = require('react-dom/server');
const { harness, elements, FinanceDialog, FinanceSummary, financeContract, fixtureInquiry, fixtureEvent, data } = require('./verify-studio-ui.cjs');
const dialog = h => h.find(node => node.type === FinanceDialog);
const summary = h => h.find(node => node.type === FinanceSummary);
const draft = h => dialog(h).props.editor.draft;
const change = (h, values) => dialog(h).props.onChange({ ...draft(h), ...values });
const body = h => JSON.parse(h.calls.filter(call => call.options.method === 'POST').at(-1).options.body);
async function desk() { const h = harness(); await h.settle(); h.navigate('#bookings'); await h.settle(); return h; }
async function open(h, mode = 'payment', kind = 'payment') { summary(h).props.onOpen(mode, kind); await h.settle(); }
async function save(h, skip) { dialog(h).props.onSave(skip); await h.settle(); }
let groups = 0;
async function group(label, fn) { await fn(); groups++; console.log('✓ Finance UI: ' + label); }
(async () => {
  await group('quote and booked dialogs are optional, preserve zero and carry current revisions', async () => {
    const h = await desk();
    h.changeStatus('Quote sent'); await h.settle(); assert.equal(h.countPosts(), 0); assert.equal(draft(h).amount, '');
    change(h, { amount: '425.50' }); await h.settle(); await save(h);
    assert.equal(body(h).amount, '425.50'); assert.equal(body(h).inquiryRevision, 'legacy'); assert.equal(body(h).status, 'Quote sent');
    h.changeStatus('Booked'); await h.settle(); assert.equal(draft(h).amount, '425.50', 'quote prefills agreed amount');
    change(h, { amount: '0' }); await h.settle(); await save(h);
    assert.equal(h.getRows().inquiries[0].bookedAmountCents, 0, 'no-charge agreement is not missing');
    assert.match(h.html(), /Agreed booking<\/dt><dd>\$0.00/);
    h.changeStatus('Contacted'); await h.settle(); h.changeStatus('Booked'); await h.settle(); assert.equal(draft(h).amount, '0.00', 'saved zero wins over quote');
    change(h, { amount: '999' }); await h.settle(); await save(h, true);
    assert.equal(body(h).amount, undefined, 'skip never submits a price'); assert.equal(h.getRows().inquiries[0].bookedAmountCents, 0);
    h.close();
  });
  await group('explicit corrections distinguish unknown from zero; draft and canceled dismissals persist', async () => {
    const h = await desk(); await open(h, 'amounts'); change(h, { quotedAmount: '0', bookedAmount: '' }); await h.settle();
    assert.equal(h.beforeUnload(), true); h.navigate('#calendar'); await h.settle(); h.navigate('#bookings'); await h.settle(); assert.equal(draft(h).quotedAmount, '0');
    h.setConfirmed(false); dialog(h).props.onClose(); await h.settle(); assert.equal(draft(h).quotedAmount, '0');
    await save(h); assert.equal(body(h).quotedAmount, '0'); assert.equal(body(h).bookedAmount, null);
    assert.match(h.html(), /Quoted<\/dt><dd>\$0.00/); assert.match(h.html(), /Agreed booking<\/dt><dd>Not recorded/); assert.match(h.html(), /Balance unknown/);
    h.close();
  });
  await group('manual records require deliberate method, positive strict money, valid dates; repeats write once', async () => {
    const h = await desk(); await open(h); const id = draft(h).recordId;
    assert.match(id, /^[0-9a-f-]{36}$/); assert.equal(draft(h).method, '', 'never silently assumes Cash');
    for (const amount of ['-1', 'NaN', '1.001', '1e3', '0']) { change(h, { amount, method: 'Venmo' }); await h.settle(); await save(h); assert.equal(h.countPosts(), 0, amount); }
    change(h, { amount: '125.25', method: '' }); await h.settle(); await save(h); assert.equal(h.countPosts(), 0);
    change(h, { method: 'Venmo', paidOn: '2099-01-01' }); await h.settle(); await save(h); assert.equal(h.countPosts(), 0);
    change(h, { paidOn: financeContract.businessToday() }); await h.settle();
    h.navigate('#settings'); await h.settle(); h.navigate('#bookings'); await h.settle(); assert.equal(draft(h).recordId, id); assert.equal(draft(h).amount, '125.25');
    const release = h.holdPosts(); dialog(h).props.onSave(); dialog(h).props.onSave(); await h.settle();
    assert.equal(h.countPosts(), 1); assert.equal(dialog(h).props.busy, true); dialog(h).props.onClose(); await h.settle(); assert.equal(draft(h).recordId, id);
    release(); await h.settle(); assert.equal(body(h).recordId, id); assert.equal(body(h).kind, 'payment'); assert.equal(h.getRows().financialRecords.length, 1);
    assert.match(h.html(), /Net received/); assert.match(h.html(), /\$125.25/); assert.match(h.html(), /Nothing here charges, transfers, or verifies money/);
    h.close();
  });
  await group('overpayments need an explicit acknowledgement; refunds cannot exceed recorded receipt', async () => {
    const h = await desk(); h.setRows([{ ...fixtureInquiry, bookedAmountCents: 10000, status: 'Booked' }], [fixtureEvent]); h.button('Refresh desk').props.onClick(); await h.settle();
    await open(h); change(h, { amount: '125', method: 'Cash' }); await h.settle(); h.setConfirmed(false); await save(h); assert.equal(h.countPosts(), 0); assert.match(h.confirmations.at(-1), /overpayment of \$25.00/);
    h.setConfirmed(true); await save(h); assert.match(h.html(), /Recorded overpayment: \$25.00/); assert.doesNotMatch(h.html(), /Recorded balance: -/);
    await open(h, 'payment', 'refund'); change(h, { amount: '126', method: 'Cash' }); await h.settle(); await save(h); assert.equal(h.countPosts(), 1); assert.match(h.html(), /cannot exceed/);
    change(h, { amount: '25' }); await h.settle(); await save(h); assert.equal(h.getRows().financialRecords.length, 2); assert.equal(body(h).kind, 'refund');
    assert.equal(financeContract.financeTotals(h.getRows().financialRecords).netReceivedCents, 10000);
    h.close();
  });
  await group('409 recovery keeps exact payment draft and idempotency key while refreshing revision', async () => {
    const h = await desk(); await open(h); change(h, { amount: '99.99', method: 'PayPal' }); await h.settle(); const id = draft(h).recordId;
    h.setPostFailure('409'); await save(h); assert.match(h.html(), /Date already occupied/); assert.equal(dialog(h).props.stale, false, 'server conflict can precede local knowledge'); assert.match(h.html(), /Reload saved values/, 'recovery remains available inside modal');
    h.setPostFailure(''); h.setRows([{ ...fixtureInquiry, revision: 'external-revision' }], [fixtureEvent]); dialog(h).props.onReload(); await h.settle();
    assert.equal(draft(h).revision, 'external-revision'); assert.equal(draft(h).recordId, id); assert.equal(draft(h).amount, '99.99'); assert.equal(draft(h).method, 'PayPal');
    assert.equal(h.beforeUnload(), true, 'reloaded unsaved payment is still dirty'); h.setConfirmed(false); dialog(h).props.onClose(); await h.settle(); assert.equal(draft(h).recordId, id, 'Cancel still protects retained unsaved draft'); h.setConfirmed(true);
    await save(h); assert.equal(body(h).recordId, id); assert.equal(body(h).inquiryRevision, 'external-revision'); h.close();
  });
  await group('reloading a destructive status acknowledges the latest calendar details explicitly', async () => {
    const h = await desk(); const event = { ...fixtureEvent, id: 'booking-' + fixtureInquiry.id, revision: 'calendar-old' };
    h.setRows([{ ...fixtureInquiry, status: 'Booked' }], [event]); h.button('Refresh desk').props.onClick(); await h.settle(); h.changeStatus('Quote sent'); await h.settle();
    assert.equal(draft(h).bookingRevision, 'calendar-old');
    h.setRows([{ ...fixtureInquiry, status: 'Booked' }], [{ ...event, revision: 'calendar-new' }]); dialog(h).props.onReload(); await h.settle();
    assert.match(h.confirmations.at(-1), /latest saved private event details/); assert.equal(draft(h).bookingRevision, 'calendar-new');
    h.close();
  });
  await group('lost success response cannot create a second record; refreshed history confirms original ID', async () => {
    const h = await desk(); await open(h); change(h, { amount: '80', method: 'Stripe' }); await h.settle(); const id = draft(h).recordId;
    h.setPostFailure('saved-network'); await save(h); assert.match(h.html(), /may already be saved/); assert.equal(elements(h.tree, node => node.type === FinanceDialog).length, 0, 'unconfirmed private data is hidden'); assert.equal(h.getRows().financialRecords.length, 1);
    h.setPostFailure(''); h.button('Refresh desk').props.onClick(); await h.settle(); assert.equal(draft(h).recordId, id); assert.equal(dialog(h).props.alreadySaved, true); assert.match(h.html(), /already saved/);
    await save(h); assert.equal(h.countPosts(), 1); assert.equal(h.getRows().financialRecords.length, 1); h.close();
  });
  await group('void confirmation identifies target and keeps escaped audit history; cancellation does not erase money', async () => {
    const h = await desk(); await open(h); change(h, { amount: '77.25', method: 'Other' }); await h.settle(); await save(h);
    const record = h.getRows().financialRecords[0]; summary(h).props.onVoid(record); await h.settle();
    assert.match(h.html(), /Payment · \$77.25/); assert.match(h.html(), /Other\. No money will move/);
    change(h, { reason: 'Two\nlines' }); await h.settle(); const beforeVoid = h.countPosts(); await save(h); assert.equal(h.countPosts(), beforeVoid); assert.match(h.html(), /single-line reason/);
    change(h, { reason: 'Duplicate <script>record</script>' }); await h.settle(); await save(h);
    assert.equal(body(h).action, 'void-payment'); assert.equal(body(h).recordId, record.id); assert.equal(h.getRows().financialRecords.length, 1);
    assert.match(h.html(), /Voided · excluded/); assert.match(h.html(), /Duplicate &lt;script&gt;record&lt;\/script&gt;/); assert.doesNotMatch(h.html(), /<script>record/); assert.equal(financeContract.financeTotals(h.getRows().financialRecords).netReceivedCents, 0);
    h.changeStatus('Canceled'); await h.settle(); assert.equal(h.getRows().financialRecords.length, 1); assert.match(h.html(), /Canceled booking — this is not an amount due/); h.close();
  });
  await group('session expiry clears finance drafts and fields, unlike a recoverable read interruption', async () => {
    for (const failure of ['403', 'html']) {
      const h = await desk(); await open(h); change(h, { amount: '350', method: 'Venmo' }); await h.settle();
      h.setGetFailure('network'); h.button('Refresh desk').props.onClick(); await h.settle(); assert.equal(elements(h.tree, node => node.type === FinanceDialog).length, 0);
      h.setGetFailure(''); h.button('Refresh desk').props.onClick(); await h.settle(); assert.equal(draft(h).amount, '350');
      h.setGetFailure(failure); h.button('Refresh desk').props.onClick(); await h.settle(); h.setGetFailure(''); h.button('Refresh desk').props.onClick(); await h.settle();
      assert.equal(elements(h.tree, node => node.type === FinanceDialog).length, 0); await open(h); assert.equal(draft(h).amount, ''); assert.equal(draft(h).method, ''); h.close();
    }
  });
  await group('native modal uses showModal/close/focus restoration, labeled fields and cancel interception', async () => {
    const effects = []; let shown = 0, closed = 0, focused = 0, canceled = 0;
    const node = { showModal() { shown++; }, close() { closed++; } };
    const mod = { exports: {} };
    const compiled = ts.transpileModule(fs.readFileSync('app/studio/booking-finance.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    vm.runInNewContext(compiled, { module: mod, exports: mod.exports, Date, Intl, document: { activeElement: { isConnected: true, focus() { focused++; } } }, require(name) { if (name === 'react') return { useRef: () => ({ current: node }), useEffect: effect => effects.push(effect) }; if (name === '../booking-finance-contract') return financeContract; if (name === './studio-data') return data; return require(name); } });
    const d = { ...mod.exports.newFinanceDraft(fixtureInquiry, 'payment', financeContract.businessToday()), recordId: crypto.randomUUID() };
    const tree = mod.exports.default({ editor: { original: d, draft: d }, inquiry: fixtureInquiry, busy: false, stale: false, alreadySaved: false, today: financeContract.businessToday(), error: '', onChange() {}, onClose() { canceled++; }, onReload() {}, onSave() {} });
    const cleanup = effects[0](); assert.equal(shown, 1); assert.equal(tree.type, 'dialog'); assert.equal(tree.props['aria-labelledby'], 'finance-dialog-title');
    let prevented = false; tree.props.onCancel({ preventDefault() { prevented = true; } }); assert(prevented); assert.equal(canceled, 1);
    assert.match(renderToStaticMarkup(tree), /aria-label="Payment amount"/); assert.match(renderToStaticMarkup(tree), /Choose method/);
    cleanup(); assert.equal(closed, 1); assert.equal(focused, 1);
  });
  console.log(`${groups} booking finance UI groups passed. Browser layout and authenticated browser behavior remain separate QA.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
