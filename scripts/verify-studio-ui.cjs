// Deterministic actual-component checks. Requests use local fixtures, never a real server.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');
function transpile(file) { return ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText; }
const helper = { exports: {} };
vm.runInNewContext(transpile('app/studio/studio-data.ts'), { module: helper, exports: helper.exports, Date, URLSearchParams });
const data = helper.exports;
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node == null || typeof node === 'boolean' ? '' : String(node);
const elements = (node, test) => Array.isArray(node) ? node.flatMap(child => elements(child, test)) : !node || typeof node !== 'object' || !node.props ? [] : [...(test(node) ? [node] : []), ...elements(node.props.children, test)];
const today = data.localDay();
const fixtureInquiry = { id: 'test-inquiry', name: 'Local <script>name</script>', email: 'qa@example.invalid', phone: '5550100', date: data.addDays(today, 3), venue: 'Local test venue', eventType: 'Wedding', guests: '80', hours: '5–11 PM', services: '["DJ service"]', message: 'Original local test message.', status: 'New', createdAt: new Date().toISOString() };
const fixtureEvent = { id: 'test-event', title: 'Local test event', date: data.addDays(today, 2), start: '18:00', end: '23:00', venue: 'Test venue', type: 'Private booking', isPublic: false, facebook: '', notes: 'Private fixture notes' };
function harness() {
  const slots = [], effects = [], listeners = new Map(), calls = [];
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
  const browser = { location: { get hash() { return hash; }, set hash(value) { navigate(value); } }, addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); }, removeEventListener(name, fn) { listeners.get(name)?.delete(fn); }, confirm: () => confirmed };
  function Panel() { return null; } function Photo() { return null; }
  const mod = { exports: {} };
  vm.runInNewContext(transpile('app/studio/studio.tsx'), {
    module: mod, exports: mod.exports,
    require(name) { if (name === 'react') return hooks; if (name === './studio-data') return data; if (name === './testimonials-panel') return { __esModule: true, default: Panel }; if (name === './studio-photo') return { __esModule: true, default: Photo }; if (name.endsWith('.css')) return {}; if (name === 'next/link') throw new Error('Studio must use native anchors.'); return require(name); },
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
      if (body.action === 'event') events.push({ id: 'local-added', ...body });
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
  return { render, settle, calls, find, button, navigate, countPosts, get tree() { return tree; }, html: () => renderToStaticMarkup(tree), getHash: () => hash, setConfirmed(value) { confirmed = value; }, setGetFailure(value) { getFailure = value; }, setPostFailure(value) { postFailure = value; }, setRows(q, e) { inquiries = q; events = e; }, holdPosts() { let release; postGate = new Promise(resolve => { release = resolve; }); return () => { postGate = null; release(); }; }, setPending(value) { find(node => node.type === Panel).props.onPendingCountChange(value); }, close() { for (const slot of slots) slot?.cleanup?.(); }, clickAnchor(href) { const matches = elements(tree, node => node.type === 'a' && node.props.href === href); assert(matches.length); matches[0].props.onClick?.(); navigate(href); }, changeStatus(status) { find(node => node.type === 'select' && node.props['aria-label'] === 'Status for ' + fixtureInquiry.name).props.onChange({ target: { value: status } }); } };
}
(async () => {
  const h = harness(); assert.match(h.html(), /Finding your next date/); assert.match(h.html(), /— new inquiries/, 'not false zero while loading'); await h.settle(); h.setPending(2); await h.settle();
  assert.match(h.html(), /2 testimonials waiting/); assert.match(h.html(), /1 new inquiry/); assert.match(h.html(), /Local test event/); assert.doesNotMatch(h.html(), /Sample Event|Event checklist ready/);
  h.navigate('#bookings'); await h.settle(); assert.match(h.html(), /Booking Desk/); assert.match(h.html(), /&lt;script&gt;name&lt;\/script&gt;/); assert.doesNotMatch(h.html(), /<script>name/);
  const release = h.holdPosts(); h.changeStatus('Contacted'); h.changeStatus('Contacted'); await h.settle(); assert.equal(h.countPosts(), 1, 'duplicate synchronous status changes guarded'); assert.equal(h.find(node => node.type === 'select' && node.props['aria-label']).props.disabled, true); release(); await h.settle(); assert.match(h.html(), /Saved. Your desk is up to date/);
  h.navigate('#deck'); await h.settle(); assert.match(h.html(), /0 new inquiries/); h.setPending(0); await h.settle(); assert.match(h.html(), /all caught up/);
  h.clickAnchor('#calendar?event=test-event'); await h.settle(); assert.match(h.html(), /Private fixture notes/); assert.match(h.html(), /Show full schedule/);
  h.button('Next month').props.onClick(); await h.settle(); assert.doesNotMatch(h.html(), /Show full schedule/); h.button('Today').props.onClick(); await h.settle(); assert.match(h.html(), /No saved entry for this date/); assert.match(h.html(), /not an availability guarantee/);
  h.clickAnchor('#add-date'); await h.settle(); const posts = h.countPosts(); h.button('Cancel').props.onClick(); await h.settle(); assert.equal(h.countPosts(), posts, 'cancel does not write');
  h.setConfirmed(false); h.button('Show full schedule').props.onClick(); await h.settle(); h.button('Remove entry').props.onClick(); await h.settle(); assert.equal(h.countPosts(), posts, 'remove confirmation cancellation does not write');
  // A submitted date save cannot be canceled by an anchor or override newer navigation.
  h.clickAnchor('#add-date'); await h.settle();
  h.find(node => node.type === 'input' && node.props.maxLength === 200).props.onChange({ target: { value: 'Pending local date' } }); await h.settle();
  const releaseDate = h.holdPosts(); const saving = h.find(node => node.type === 'form').props.onSubmit({ preventDefault() {} }); await h.settle();
  assert.equal(h.button('Cancel').props.disabled, true); h.button('Cancel').props.onClick(); assert.equal(h.getHash(), '#add-date', 'pending Cancel cannot imply save was canceled');
  h.navigate('#bookings'); await h.settle(); releaseDate(); await saving; await h.settle(); assert.equal(h.getHash(), '#bookings', 'completed save respects newer navigation');
  let prevented = false; h.find(node => node.type === 'a' && node.props.className === 'studio-skip').props.onClick({ preventDefault() { prevented = true; } }); assert(prevented); assert.equal(h.getHash(), '#bookings', 'skip link does not route back to Deck');
  h.navigate('#voices'); await h.settle(); const container = h.find(node => node.type === 'div' && elements(node.props.children, child => typeof child.type === 'function' && child.type.name === 'Panel').length === 1 && node.props.hidden !== undefined); assert.equal(container.props.hidden, false);
  h.navigate('#settings'); await h.settle(); assert.match(h.html(), /What your desk does today/); assert.match(h.html(), /Yahoo \/ phone sync is not connected/);
  h.navigate('#bookings'); await h.settle(); h.setPostFailure('malformed'); h.changeStatus('Booked'); await h.settle(); assert.match(h.html(), /may already be saved/); assert.doesNotMatch(h.html(), /qa@example.invalid/, 'unconfirmed malformed success clears private controls');
  h.setPostFailure(''); h.button('Refresh desk').props.onClick(); await h.settle(); assert.match(h.html(), /qa@example.invalid/);
  h.setGetFailure('403'); h.button('Refresh desk').props.onClick(); await h.settle(); assert.doesNotMatch(h.html(), /qa@example.invalid/); assert.match(h.html(), /Manager sign-in required/); h.navigate('#deck'); await h.settle(); assert.match(h.html(), /— new inquiries/); assert.doesNotMatch(h.html(), /Local test event/);
  h.setGetFailure(''); h.setRows([], []); h.button('Refresh desk').props.onClick(); await h.settle(); assert.match(h.html(), /Your next good night awaits/); assert.match(h.html(), /No saved events or blocked dates/);
  h.navigate('#bookings'); await h.settle(); assert.match(h.html(), /A fresh start/);
  h.setGetFailure('html'); h.button('Refresh desk').props.onClick(); await h.settle(); assert.match(h.html(), /session may have expired/);
  h.close();
  console.log('Studio UI checks passed: truthful loading/empty counts, real next event, pending queue, native hash navigation, escaped inquiry data, duplicate status guard, saved refresh, event deep link, month/day selection, cancel/remove cancellation, moderation mount, Settings copy, uncertain JSON write recovery, 403 clearing, HTML expiry, retry, empty states.');
})().catch(error => { console.error(error); process.exitCode = 1; });
