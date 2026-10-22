// Deterministic actual-component checks. Requests use local fixtures, never a real server.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');
function transpile(file) { return ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText; }
const contractModule = { exports: {} };
vm.runInNewContext(transpile('app/event-details-contract.ts'), { module: contractModule, exports: contractModule.exports });
const contract = contractModule.exports;
const helper = { exports: {} };
vm.runInNewContext(transpile('app/studio/studio-data.ts'), { module: helper, exports: helper.exports, Date, URLSearchParams, require: name => { if (name === '../event-details-contract') return contract; throw Error(name); } });
const data = helper.exports;
const fieldsModule = { exports: {} };
vm.runInNewContext(transpile('app/studio/event-detail-fields.tsx'), { module: fieldsModule, exports: fieldsModule.exports, require: name => name === '../event-details-contract' ? contract : name === './studio-data' ? data : require(name) });
const fields = fieldsModule.exports;
const snapshotDataModule = { exports: {} };
vm.runInNewContext(transpile('app/studio/business-snapshot-data.ts'), { module: snapshotDataModule, exports: snapshotDataModule.exports, Date, Intl });
const snapshotModule = { exports: {} };
vm.runInNewContext(transpile('app/studio/business-snapshot.tsx'), { module: snapshotModule, exports: snapshotModule.exports, Date, Intl, require: name => name === './business-snapshot-data' ? snapshotDataModule.exports : name.endsWith('.css') ? {} : require(name) });
const Snapshot = snapshotModule.exports.default;
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node == null || typeof node === 'boolean' ? '' : String(node);
const elements = (node, test) => Array.isArray(node) ? node.flatMap(child => elements(child, test)) : !node || typeof node !== 'object' || !node.props ? [] : [...(test(node) ? [node] : []), ...elements(node.props.children, test)];
const today = data.localDay();
const fixtureInquiry = { id: 'test-inquiry', name: 'Local <script>name</script>', email: 'qa@example.invalid', phone: '5550100', date: data.addDays(today, 3), venue: 'Local test venue', eventType: 'Wedding', guests: '80', hours: '5–11 PM', services: '["DJ service"]', message: 'Original local test message.', status: 'New', createdAt: new Date().toISOString() };
const fixtureEvent = { id: 'test-event', title: 'Local test event', date: data.addDays(today, 2), start: '18:00', end: '23:00', venue: 'Test venue', type: 'Private booking', isPublic: false, facebook: '', notes: 'Private fixture notes', servicePlan: null, contactName: null, contactEmail: null, contactPhone: null, revision: 'fixture-1' };
function harness() {
  const slots = [], effects = [], listeners = new Map(), calls = [], confirmations = [];
  let cursor = 0, tree, dirty = false, hash = '', confirmed = true, getFailure = '', postFailure = '', postGate = null;
  let inquiries = [{ ...fixtureInquiry }], events = [{ ...fixtureEvent }];
  function changed(a, b) { return !a || !b || a.length !== b.length || a.some((item, index) => item !== b[index]); }
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { const next = typeof value === 'function' ? value(slots[i]) : value; if (next !== slots[i]) { slots[i] = next; dirty = true; } }]; },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
    useCallback(fn, deps) { const i = cursor++; if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { fn, deps }; return slots[i].fn; },
    useEffect(fn, deps) { const i = cursor++; if (!slots[i] || changed(slots[i].deps, deps)) { const before = slots[i]; slots[i] = { deps, cleanup: before?.cleanup }; effects.push(() => { before?.cleanup?.(); slots[i].cleanup = fn(); }); } },
  };
  function navigate(value) { hash = value.startsWith('#') ? value : '#' + value; listeners.get('hashchange')?.forEach(fn => fn()); }
  const browser = { location: { get hash() { return hash; }, set hash(value) { navigate(value); } }, addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); }, removeEventListener(name, fn) { listeners.get(name)?.delete(fn); }, confirm: message => { confirmations.push(message); return confirmed; } };
  function Panel() { return null; } function Photo() { return null; }
  const mod = { exports: {} };
  vm.runInNewContext(transpile('app/studio/studio.tsx'), {
    module: mod, exports: mod.exports,
    require(name) { if (name === 'react') return hooks; if (name === './studio-data') return data; if (name === './business-snapshot') return snapshotModule.exports; if (name === './event-detail-fields') return fields; if (name === './testimonials-panel') return { __esModule: true, default: Panel }; if (name === './studio-photo') return { __esModule: true, default: Photo }; if (name.endsWith('.css')) return {}; if (name === 'next/link') throw new Error('Studio must use native anchors.'); return require(name); },
    fetch: async (url, options = {}) => {
      calls.push({ url, options }); assert.equal(url, '/api/manage');
      if (!options.method) {
        if (getFailure === '403') return Response.json({ error: 'Manager sign-in required.' }, { status: 403 });
        if (getFailure === 'html') return new Response('<html>sign in</html>', { headers: { 'Content-Type': 'text/html' } });
        if (getFailure === 'network') throw new TypeError('Local test interruption');
        return Response.json({ inquiries, events });
      }
      if (postGate) await postGate;
      if (postFailure === 'malformed') return new Response('{', { headers: { 'Content-Type': 'application/json' } });
      if (postFailure === 'network') throw new TypeError('Local test interruption');
      if (postFailure === '403') return Response.json({ error: 'Manager sign-in required.' }, { status: 403 });
      if (postFailure === '409') return Response.json({ error: 'Date already occupied.' }, { status: 409 });
      const body = JSON.parse(options.body);
      if (body.action === 'status') { inquiries = inquiries.map(inquiry => inquiry.id === body.id ? { ...inquiry, status: body.status } : inquiry); }
      if (body.action === 'delete-event') events = events.filter(event => event.id !== body.id);
      if (body.action === 'event') events.push({ id: 'local-added', revision: 'new-event-revision', ...body });
      if (body.action === 'update-event-details') { const row = events.find(event => event.id === body.id); if (!row) return Response.json({ error: 'Entry not found.' }, { status: 404 }); if (row.revision !== body.revision) return Response.json({ error: 'These details changed. Reload before saving.' }, { status: 409 }); const { action, id, revision, ...details } = body; events = events.map(event => event.id === id ? { ...event, ...details, revision: 'saved-' + calls.length } : event); }
      return Response.json({ ok: true });
    },
    window: { ...browser, scrollTo() {} }, document: { createElement: () => ({ click() {} }) }, URL, URLSearchParams, Blob, Response, Date, Error, TypeError, Array, JSON, Number, String, AbortController, setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
  });
  function render() { cursor = 0; dirty = false; tree = mod.exports.default(); effects.splice(0).forEach(effect => effect()); return tree; }
  async function settle() { for (let i = 0; i < 5; i++) { if (dirty || !tree) render(); await new Promise(resolve => setTimeout(resolve, 8)); } if (dirty) render(); }
  const find = test => { const found = elements(tree, test); assert.equal(found.length, 1, 'one matching element'); return found[0]; };
  const button = label => find(node => node.type === 'button' && (text(node) === label || node.props['aria-label'] === label));
  const countPosts = () => calls.filter(call => call.options.method === 'POST').length;
  render();
  return { render, settle, calls, confirmations, find, button, navigate, countPosts, changeDetail(name, value) { const field = find(node => node.type === fields.default); field.props.onChange({ ...field.props.value, [name]: value }); }, detail(name) { return find(node => node.type === fields.default).props.value[name]; }, beforeUnload() { let prevented = false; listeners.get('beforeunload')?.forEach(fn => fn({ preventDefault() { prevented = true; }, returnValue: undefined })); return prevented; }, get tree() { return tree; }, html: () => renderToStaticMarkup(tree), getHash: () => hash, setConfirmed(value) { confirmed = value; }, setGetFailure(value) { getFailure = value; }, setPostFailure(value) { postFailure = value; }, setRows(q, e) { inquiries = q; events = e; }, holdPosts() { let release; postGate = new Promise(resolve => { release = resolve; }); return () => { postGate = null; release(); }; }, setPending(value) { find(node => node.type === Panel).props.onPendingCountChange(value); }, close() { for (const slot of slots) slot?.cleanup?.(); }, clickAnchor(href) { const matches = elements(tree, node => node.type === 'a' && node.props.href === href); assert(matches.length); matches[0].props.onClick?.(); navigate(href); }, changeStatus(status) { find(node => node.type === 'select' && node.props['aria-label'] === 'Status for ' + fixtureInquiry.name).props.onChange({ target: { value: status } }); } };
}
(async () => {
  const h = harness(); assert.match(h.html(), /Finding your next date/); assert.match(h.html(), /— new inquiries/, 'not false zero while loading'); await h.settle(); h.setPending(2); await h.settle();
  assert.match(h.html(), /2 testimonials waiting/); assert.match(h.html(), /1 new inquiry/); assert.match(h.html(), /Local test event/); assert.doesNotMatch(h.html(), /Sample Event|Event checklist ready/);
  h.clickAnchor('#snapshot'); await h.settle(); assert.match(h.html(), /Last 30 complete days/); assert.match(h.html(), /Website visits &amp; daily average/); assert.match(h.html(), /Not connected/); assert.doesNotMatch(h.html(), /qa@example.invalid|Private fixture notes|&lt;script&gt;name/);
  const snapshot = h.find(node => node.type === Snapshot); snapshot.props.onReviewNew(); h.navigate('#bookings'); await h.settle();
  assert.equal(h.find(node => node.type === 'select' && !node.props['aria-label']).props.value, 'New', 'snapshot follow-up opens New filter');
  h.find(node => node.type === 'select' && !node.props['aria-label']).props.onChange({ target: { value: 'All' } }); await h.settle();
  h.navigate('#bookings'); await h.settle(); assert.match(h.html(), /Booking Desk/); assert.match(h.html(), /&lt;script&gt;name&lt;\/script&gt;/); assert.doesNotMatch(h.html(), /<script>name/);
  const release = h.holdPosts(); h.changeStatus('Contacted'); h.changeStatus('Contacted'); await h.settle(); assert.equal(h.countPosts(), 1, 'duplicate synchronous status changes guarded'); assert.equal(h.find(node => node.type === 'select' && node.props['aria-label']).props.disabled, true); release(); await h.settle(); assert.match(h.html(), /Saved. Your desk is up to date/);
  h.navigate('#deck'); await h.settle(); assert.match(h.html(), /0 new inquiries/); h.setPending(0); await h.settle(); assert.match(h.html(), /all caught up/);
  h.clickAnchor('#calendar?event=test-event'); await h.settle(); assert.match(h.html(), /Private fixture notes/); assert.match(h.html(), /Show full schedule/);
  h.button('Next month').props.onClick(); await h.settle(); assert.doesNotMatch(h.html(), /Show full schedule/); h.button('Today').props.onClick(); await h.settle(); assert.match(h.html(), /No saved entry for this date/); assert.match(h.html(), /not an availability guarantee/);
  h.clickAnchor('#add-date'); await h.settle(); const posts = h.countPosts(); h.button('Cancel').props.onClick(); await h.settle(); assert.equal(h.countPosts(), posts, 'cancel does not write');
  h.setConfirmed(false); h.button('Show full schedule').props.onClick(); await h.settle(); h.button('Remove entry').props.onClick(); await h.settle(); assert.equal(h.countPosts(), posts, 'remove confirmation cancellation does not write');
  // A submitted date save cannot be canceled by an anchor or override newer navigation.
  h.clickAnchor('#add-date'); await h.settle();
  h.find(node => node.type === 'input' && node.props.maxLength === 200 && node.props.required).props.onChange({ target: { value: 'Pending local date' } }); await h.settle();
  const releaseDate = h.holdPosts(); const saving = h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await h.settle();
  assert.equal(h.button('Cancel').props.disabled, true); h.button('Cancel').props.onClick(); assert.equal(h.getHash(), '#add-date', 'pending Cancel cannot imply save was canceled');
  h.navigate('#bookings'); await h.settle(); releaseDate(); await saving; await h.settle(); assert.equal(h.getHash(), '#bookings', 'completed save respects newer navigation');
  let prevented = false; h.find(node => node.type === 'a' && node.props.className === 'studio-skip').props.onClick({ preventDefault() { prevented = true; } }); assert(prevented); assert.equal(h.getHash(), '#bookings', 'skip link does not route back to Deck');
  h.navigate('#voices'); await h.settle(); const container = h.find(node => node.type === 'div' && elements(node.props.children, child => typeof child.type === 'function' && child.type.name === 'Panel').length === 1 && node.props.hidden !== undefined); assert.equal(container.props.hidden, false);
  h.navigate('#settings'); await h.settle(); assert.match(h.html(), /What your desk does today/); assert.match(h.html(), /Yahoo \/ phone sync is not connected/);
  h.navigate('#bookings'); await h.settle(); h.setPostFailure('malformed'); h.changeStatus('Booked'); await h.settle(); assert.match(h.html(), /may already be saved/); assert.doesNotMatch(h.html(), /qa@example.invalid/, 'unconfirmed malformed success clears private controls');
  h.setPostFailure(''); h.button('Refresh desk').props.onClick(); await h.settle(); assert.match(h.html(), /qa@example.invalid/);
  h.navigate('#snapshot'); await h.settle(); h.setGetFailure('403'); h.button('Refresh desk').props.onClick(); await h.settle(); assert.doesNotMatch(h.html(), /qa@example.invalid/); assert.match(h.html(), /Manager sign-in required/); assert.match(h.html(), /Your snapshot is unavailable/); assert.doesNotMatch(h.html(), /snapshot-metric/); h.navigate('#deck'); await h.settle(); assert.match(h.html(), /— new inquiries/); assert.doesNotMatch(h.html(), /Local test event/);
  h.setGetFailure(''); h.setRows([], []); h.button('Refresh desk').props.onClick(); await h.settle(); assert.match(h.html(), /Your next good night awaits/); assert.match(h.html(), /No saved events or blocked dates/);
  h.navigate('#bookings'); await h.settle(); assert.match(h.html(), /A fresh start/);
  h.setGetFailure('html'); h.button('Refresh desk').props.onClick(); await h.settle(); assert.match(h.html(), /session may have expired/);
  h.close();

  // Private details use the actual Studio handlers and actual field component.
  const e = harness(); await e.settle();
  const linked = { ...fixtureEvent, id: 'booking-' + fixtureInquiry.id, notes: 'L'.repeat(3100), revision: 'legacy' };
  e.setRows([{ ...fixtureInquiry, status: 'Booked' }], [linked]); e.button('Refresh desk').props.onClick(); await e.settle();
  e.navigate('#calendar?event=' + linked.id); await e.settle();
  assert.match(e.html(), /Email qa@example.invalid/); assert.match(e.html(), /Call 5550100/);
  assert.doesNotMatch(e.html(), /<script>name/);
  e.button('Edit private details').props.onClick(); await e.settle();
  assert.equal(e.detail('servicePlan'), 'DJ service'); assert.equal(e.detail('contactName'), fixtureInquiry.name); assert.equal(e.detail('notes').length, 3100);
  assert.equal(e.beforeUnload(), false);
  e.changeDetail('servicePlan', 'Uplighting\nTwo speakers'); await e.settle();
  e.changeDetail('contactName', 'Coordinator <script>private</script>'); await e.settle();
  e.changeDetail('contactEmail', 'coordinator@example.invalid'); await e.settle();
  e.changeDetail('contactPhone', '+1 (555) 010-1234'); await e.settle();
  e.changeDetail('notes', 'Use side entrance\nAsk for Pat'); await e.settle();
  assert.equal(e.beforeUnload(), true, 'dirty event editor warns before page unload');
  e.navigate('#bookings'); await e.settle(); e.navigate('#calendar?event=' + linked.id); await e.settle();
  assert.equal(e.detail('notes'), 'Use side entrance\nAsk for Pat', 'Back/Forward-style hash navigation retains draft');
  e.button('Refresh desk').props.onClick(); await e.settle(); assert.equal(e.detail('contactName'), 'Coordinator <script>private</script>', 'read refresh does not overwrite dirty draft');
  e.setConfirmed(false); e.button('Cancel edits').props.onClick(); await e.settle(); assert.equal(e.detail('contactEmail'), 'coordinator@example.invalid', 'declined discard retains draft');
  const beforeSave = e.countPosts(); const releaseEdit = e.holdPosts();
  const editForm = e.find(node => node.type === 'form'); const savingEdit = editForm.props.onSubmit({ preventDefault() {} }); void editForm.props.onSubmit({ preventDefault() {} }); await e.settle();
  assert.equal(e.countPosts(), beforeSave + 1, 'repeated event save writes once');
  assert.equal(e.button('Cancel edits').props.disabled, true); e.button('Cancel edits').props.onClick();
  const payload = JSON.parse(e.calls.filter(call => call.options.method === 'POST').at(-1).options.body);
  assert.deepEqual(Object.keys(payload).sort(), ['action', 'id', 'revision', 'servicePlan', 'contactName', 'contactEmail', 'contactPhone', 'notes'].sort(), 'editor sends only private fields and revision');
  assert.equal(payload.revision, 'legacy');
  e.navigate('#settings'); await e.settle(); releaseEdit(); await savingEdit; await e.settle(); assert.equal(e.getHash(), '#settings', 'save completion does not override newer navigation');
  e.navigate('#calendar?event=' + linked.id); await e.settle();
  assert.match(e.html(), /Coordinator &lt;script&gt;private&lt;\/script&gt;/); assert.match(e.html(), /tel:\+15550101234/); assert.match(e.html(), /Use side entrance/); assert.equal(e.beforeUnload(), false);
  e.button('Edit private details').props.onClick(); await e.settle(); e.changeDetail('notes', 'My unsaved revision'); await e.settle();
  e.setRows([{ ...fixtureInquiry, status: 'Booked' }], [{ ...linked, notes: 'Other owner saved', contactName: 'New contact', revision: 'newer-version' }]);
  e.button('Refresh desk').props.onClick(); await e.settle(); assert.equal(e.detail('notes'), 'My unsaved revision'); assert.equal(e.button('Save changes').props.disabled, true); assert.match(e.html(), /newer saved details/);
  e.setConfirmed(false); e.button('Reload saved details').props.onClick(); await e.settle(); assert.equal(e.detail('notes'), 'My unsaved revision');
  e.setConfirmed(true); e.button('Reload saved details').props.onClick(); await e.settle(); assert.equal(e.detail('notes'), 'Other owner saved'); assert.equal(e.beforeUnload(), false);
  e.changeDetail('notes', 'Draft survives conflict'); await e.settle(); e.setPostFailure('409');
  await e.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await e.settle(); assert.equal(e.detail('notes'), 'Draft survives conflict', 'server conflict retains draft');
  e.setPostFailure(''); e.setGetFailure('network'); e.button('Refresh desk').props.onClick(); await e.settle(); assert.doesNotMatch(e.html(), /Draft survives conflict/, 'unavailable private data is hidden');
  e.setGetFailure(''); e.button('Refresh desk').props.onClick(); await e.settle(); assert.equal(e.detail('notes'), 'Draft survives conflict', 'read network failure does not destroy unsaved text');
  e.setRows([{ ...fixtureInquiry, status: 'Booked' }], []); e.button('Refresh desk').props.onClick(); await e.settle(); assert.match(e.html(), /no longer available/); assert.match(e.html(), /copy them below/); assert.match(e.html(), /Draft survives conflict/); assert.equal(elements(e.tree, node => node.type === 'form').length, 0, 'missing event cannot become a create form or be resurrected');
  e.button('Discard unsaved details').props.onClick(); await e.settle(); assert.doesNotMatch(e.html(), /Draft survives conflict/);
  e.setRows([{ ...fixtureInquiry, status: 'Booked' }], [linked]); e.button('Refresh desk').props.onClick(); await e.settle();
  e.navigate('#bookings'); await e.settle(); const cancelPosts = e.countPosts();
  e.setConfirmed(false); e.changeStatus('Canceled'); await e.settle(); assert.equal(e.countPosts(), cancelPosts); assert.match(e.confirmations.at(-1), /all saved private event details/);
  e.setConfirmed(true); e.changeStatus('Canceled'); await e.settle(); const canceled = JSON.parse(e.calls.filter(call => call.options.method === 'POST').at(-1).options.body); assert.equal(canceled.bookingRevision, 'legacy');
  e.close();


  // Following an event deep link must not override a newer calendar selection on refresh/save.
  const nav = harness(); await nav.settle(); const second = { ...fixtureEvent, id: 'second-event', date: data.addDays(today, 4), title: 'Second local event', notes: 'Second notes' };
  nav.setRows([fixtureInquiry], [fixtureEvent, second]); nav.button('Refresh desk').props.onClick(); await nav.settle(); nav.navigate('#calendar?event=test-event'); await nav.settle();
  nav.find(node => node.type === 'button' && node.props['aria-label']?.includes(', Second local event,')).props.onClick(); await nav.settle(); assert.equal(nav.getHash(), '#calendar?event=second-event');
  nav.button('Edit private details').props.onClick(); await nav.settle(); nav.changeDetail('notes', 'Second edited details'); await nav.settle(); await nav.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await nav.settle();
  assert.match(nav.html(), /Second edited details/); assert.equal(nav.getHash(), '#calendar?event=second-event');
  nav.button('Next month').props.onClick(); await nav.settle(); assert.equal(nav.getHash(), '#calendar'); nav.button('Refresh desk').props.onClick(); await nav.settle(); assert.doesNotMatch(nav.html(), /Show full schedule/, 'old deep link does not reselect a day after month navigation'); nav.close();

  // Auth loss clears both edit-event and add-date contact drafts, including HTML expiry.
  for (const failure of ['403', 'html']) {
    const auth = harness(); await auth.settle(); auth.navigate('#calendar?event=test-event'); await auth.settle(); auth.button('Edit private details').props.onClick(); await auth.settle(); auth.changeDetail('contactName', 'Private editor secret'); await auth.settle();
    auth.clickAnchor('#add-date'); await auth.settle(); auth.changeDetail('contactEmail', 'private-add@example.invalid'); await auth.settle();
    auth.setGetFailure(failure); auth.button('Refresh desk').props.onClick(); await auth.settle(); assert.doesNotMatch(auth.html(), /private-add|Private editor secret/);
    auth.setGetFailure(''); auth.button('Refresh desk').props.onClick(); await auth.settle(); assert.equal(auth.detail('contactEmail'), '', 'add-date private draft cleared on auth loss');
    auth.navigate('#calendar?event=test-event'); await auth.settle(); assert.doesNotMatch(auth.html(), /Private editor secret/); auth.button('Edit private details').props.onClick(); await auth.settle(); assert.equal(auth.detail('contactName'), ''); auth.close();
  }
  const manual = harness(); await manual.settle(); manual.navigate('#calendar?event=test-event'); await manual.settle(); manual.button('Remove entry').props.onClick(); await manual.settle();
  assert.equal(JSON.parse(manual.calls.find(call => call.options.method === 'POST').options.body).revision, 'fixture-1', 'manual deletion acknowledges the displayed revision'); manual.close();
  let changedFields;
  const fieldTree = fields.default({ value: { ...contract.blankEventDetails }, onChange(value) { changedFields = value; } });
  const emailInput = elements(fieldTree, node => node.type === 'input' && node.props.name === 'contactEmail')[0]; assert.equal(emailInput.props.type, 'email'); assert.equal(emailInput.props.maxLength, 200); emailInput.props.onChange({ target: { value: 'local@example.invalid' } }); assert.equal(changedFields.contactEmail, 'local@example.invalid');
  assert.equal(elements(fieldTree, node => node.type === 'textarea' && node.props.name === 'notes')[0].props.maxLength, 6000);
  console.log('Private event UI passed: actual prefill/editor fields, long legacy notes, private-only payload, duplicate save, navigation and refresh draft preservation, stale conflict/reload, missing-event recovery, destructive confirmations/revisions, safe links/escaping, auth-expired edit/add drafts, and field limits.');

  console.log('Studio UI checks passed: truthful loading/empty counts, real next event, pending queue, native hash navigation, escaped inquiry data, duplicate status guard, saved refresh, event deep link, month/day selection, cancel/remove cancellation, moderation mount, Settings copy, uncertain JSON write recovery, 403 clearing, HTML expiry, retry, empty states.');
})().catch(error => { console.error(error); process.exitCode = 1; });
