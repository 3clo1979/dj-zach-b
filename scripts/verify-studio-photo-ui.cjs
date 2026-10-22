// Local deterministic component harness. No browser/network or real family photo.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');
// CSS contract + sizing arithmetic, not a substitute for browser layout QA.
// The loaded frame must hug an unchanged photo rather than letterbox it into 4:5.
const photoCss = fs.readFileSync('app/studio/studio.css', 'utf8');
const loadedRule = photoCss.match(/\.studio-photo-frame\.has-photo\{([^}]+)\}/)?.[1] || '';
const imageRule = photoCss.match(/\.studio-photo-frame img\{([^}]+)\}/)?.[1] || '';
for (const declaration of ['display:block', 'width:fit-content', 'max-width:100%', 'aspect-ratio:auto']) assert(loadedRule.includes(declaration), declaration);
for (const declaration of ['width:auto', 'height:auto', 'object-fit:contain', 'max-width:calc(var(--studio-frame-size,180px) - 2 * var(--studio-frame-edge))', 'max-height:calc(var(--studio-frame-max-height) - 2 * var(--studio-frame-edge))']) assert(imageRule.includes(declaration), declaration);
assert.doesNotMatch(imageRule, /(?:width|height):100%|object-fit:cover/);
assert(photoCss.includes('.studio-photo-preview img{max-width:100%;max-height:320px;width:auto;height:auto;object-fit:contain}'));
assert(photoCss.includes('.studio-header-photo .studio-photo-frame{--studio-frame-edge:5px;--studio-frame-max-height:58px;'));
assert(photoCss.includes('.studio-photo-settings .studio-photo-frame{--studio-frame-size:180px;--studio-frame-max-height:240px;'));
assert(photoCss.includes('.studio-photo-settings .studio-photo-frame{--studio-frame-size:155px;--studio-frame-edge:11px;'));
assert(photoCss.indexOf('.studio-photo-frame.has-photo{') < photoCss.indexOf('.studio-photo-settings .studio-photo-frame{'), 'Settings caps retain cascade precedence');
const headerSizes = [...photoCss.matchAll(/\.studio-header-photo\{[^}]*--studio-frame-size:(\d+)px/g)].map(match => Number(match[1]));
assert.deepEqual(headerSizes, [134, 150, 110, 93, 69, 60, 42], 'existing responsive header widths preserved; final mobile cap wins');
assert(photoCss.includes('top:42px;right:calc(6% + 53px);--studio-frame-size:42px;width:var(--studio-frame-size);transform:translateY(-50%) rotate(3deg)'), 'all photo ratios stay centered in the mobile brand bar');
const bounds = [
  { name: 'desktop', width: 134, height: 190, edge: 13 },
  { name: 'large desktop', width: 150, height: 190, edge: 13 },
  { name: 'tablet', width: 110, height: 190, edge: 13 },
  { name: 'narrow tablet', width: 93, height: 190, edge: 13 },
  { name: 'mobile header', width: 42, height: 58, edge: 5 },
  { name: 'Settings desktop', width: 180, height: 240, edge: 13 },
  { name: 'Settings mobile', width: 155, height: 240, edge: 11 },
];
for (const box of bounds) for (const [w, h] of [[1000,1000],[900,1200],[1600,900],[100,1000],[1000,100],[12,12]]) {
  const scale = Math.min(1, (box.width - 2 * box.edge - 2) / w, (box.height - 2 * box.edge - 2) / h);
  const photoW = w * scale, photoH = h * scale;
  const frameW = photoW + 2 + 2 * box.edge, frameH = photoH + 2 + 2 * box.edge;
  assert(frameW <= box.width + 0.001 && frameH <= box.height + 0.001, box.name + ' stays inside its bounds');
  assert(Math.abs(photoW / photoH - w / h) < 0.000001, box.name + ' preserves the entire photo ratio');
  if (w === h) assert.equal(frameW, frameH, box.name + ' square photo gets a square frame, not portrait bars');
}
console.log('Photo fit contract passed: natural loaded frame and preview, 42 square/portrait/landscape/extreme-ratio sizing cases, desktop/mobile/Settings caps. Browser rendering not simulated.');

const slots = [], effects = [], listeners = new Map(), activeUrls = new Set();
let cursor = 0, initial = true, confirmed = true, stored = false, unauthorized = false, uncertain = false, gate = null, puts = 0, deletes = 0, urlCount = 0, stateWrites = 0;
const VERSION = '12345678-1234-1234-1234-123456789abc';
const file = new File([new Uint8Array([1, 2, 3])], 'synthetic-ui-fixture.png', { type: 'image/png' });
const hooks = {
  useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], value => { stateWrites++; slots[i] = typeof value === 'function' ? value(slots[i]) : value; }]; },
  useRef(value) { const i = cursor++; if (!(i in slots)) slots[i] = { current: value }; return slots[i]; },
  useCallback(fn) { cursor++; return fn; },
  useEffect(fn) { cursor++; if (initial) effects.push(fn); },
};
async function fetchMock(url, options = {}) {
  assert.equal(url, '/api/manage/studio-photo');
  if (unauthorized) return Response.json({ error: 'Manager sign-in required.' }, { status: 403 });
  if (options.method === 'POST') {
    puts++; assert.equal(options.body, file, 'exact selected File sent without transformation');
    assert.equal(options.headers['X-Studio-Photo-Version'], stored ? VERSION : 'none');
    if (uncertain) throw new Error('Local simulated interruption.');
    if (gate === true) await new Promise(resolve => { gate = resolve; });
    stored = true; return Response.json({ ok: true });
  }
  if (options.method === 'DELETE') { deletes++; stored = false; return Response.json({ ok: true }); }
  assert.equal(options.cache, 'no-store');
  return stored ? new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png', 'X-Studio-Photo-Version': VERSION } }) : new Response(null, { status: 204, headers: { 'X-Studio-Photo-Version': 'none' } });
}
const moduleObject = { exports: {} };
const addListener = (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); };
const removeListener = (name, fn) => { listeners.get(name)?.delete(fn); if (!listeners.get(name)?.size) listeners.delete(name); };
const source = ts.transpileModule(fs.readFileSync('app/studio/studio-photo.tsx', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
vm.runInNewContext(source, {
  module: moduleObject, exports: moduleObject.exports,
  require(name) {
    if (name === 'react') return hooks;
    if (name === 'react/jsx-runtime' || name === 'lucide-react') return require(name);
    if (name.endsWith('studio-photo-contract')) return { STUDIO_PHOTO_MAX_BYTES: 1000000 };
    throw Error(name);
  },
  fetch: fetchMock, window: { confirm: () => confirmed, addEventListener: addListener, removeEventListener: removeListener, dispatchEvent: event => listeners.get(event.type)?.forEach(fn => fn()) },
  URL: { createObjectURL() { const url = 'blob:local-test-' + (++urlCount); activeUrls.add(url); return url; }, revokeObjectURL(url) { activeUrls.delete(url); } },
  Response, AbortController, Event, File, Blob, setTimeout, clearTimeout,
});
const Panel = moduleObject.exports.default;
const render = () => { cursor = 0; const tree = Panel({ editable: true }); initial = false; return tree; };
const elements = (node, predicate) => Array.isArray(node) ? node.flatMap(child => elements(child, predicate)) : !node || typeof node !== 'object' || !node.props ? [] : [...(predicate(node) ? [node] : []), ...elements(node.props.children, predicate)];
const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node == null ? '' : String(node);
const button = (tree, label) => { const found = elements(tree, node => node.type === 'button' && text(node).includes(label)); assert.equal(found.length, 1, label); return found[0]; };
const input = tree => elements(tree, node => node.type === 'input')[0];
const preview = tree => elements(tree, node => node.type === 'img' && node.props.alt.includes('preview'))[0];
const html = tree => renderToStaticMarkup(tree);
const settle = () => new Promise(resolve => setTimeout(resolve, 10));
(async () => {
  let tree = render(); assert.equal(input(tree).props.disabled, true);
  const cleanups = effects.map(effect => effect()); await settle(); tree = render();
  assert.match(html(tree), /Your people. Your why./); assert.equal(input(tree).props.disabled, false);
  input(tree).props.onChange({ target: { files: [new File(['<svg/>'], 'bad.svg', { type: 'image/svg+xml' })] } }); tree = render(); assert.match(html(tree), /Choose a JPEG or PNG/);
  input(tree).props.onChange({ target: { files: [file] } }); tree = render();
  assert.equal(puts, 0, 'selecting only previews, never uploads');
  assert.equal(button(tree, 'Save original').props.disabled, true, 'must decode preview before save');
  preview(tree).props.onLoad(); tree = render();
  assert.equal(button(tree, 'Save original').props.disabled, false);
  gate = true; const save = button(tree, 'Save original'); save.props.onClick(); save.props.onClick(); await settle(); tree = render();
  assert.equal(puts, 1, 'synchronous repeated clicks guarded'); assert.equal(input(tree).props.disabled, true);
  gate(); gate = null; await settle(); tree = render();
  assert.match(html(tree), /Original photo saved/); assert.equal(elements(tree, node => node.type === 'img').length, 1); assert.equal(activeUrls.size, 1, 'local candidate URL released');
  confirmed = false; button(tree, 'Remove photo').props.onClick(); await settle(); assert.equal(deletes, 0, 'canceling remove does not mutate');
  confirmed = true; button(tree, 'Remove photo').props.onClick(); await settle(); tree = render(); assert.equal(deletes, 1); assert.equal(activeUrls.size, 0); assert.match(html(tree), /Photo removed/);
  input(tree).props.onChange({ target: { files: [file] } }); tree = render(); preview(tree).props.onLoad(); tree = render(); uncertain = true;
  button(tree, 'Save original').props.onClick(); await settle(); tree = render(); assert.match(html(tree), /may already be saved/); assert.equal(button(tree, 'Save original').props.disabled, true, 'uncertain write requires reload');
  uncertain = false; button(tree, 'Reload photo').props.onClick(); await settle(); tree = render();
  button(tree, 'Cancel').props.onClick(); tree = render(); assert.equal(activeUrls.size, 0);
  stored = true; button(tree, 'Reload photo').props.onClick(); await settle(); tree = render(); assert.equal(activeUrls.size, 1);
  unauthorized = true; button(tree, 'Reload photo').props.onClick(); await settle(); tree = render(); assert.equal(activeUrls.size, 0); assert.equal(input(tree).props.disabled, true); assert.match(html(tree), /session may have expired/);
  unauthorized = false; button(tree, 'Reload photo').props.onClick(); await settle(); tree = render();
  input(tree).props.onChange({ target: { files: [file] } }); tree = render(); preview(tree).props.onLoad(); tree = render();
  gate = true; button(tree, 'Save original').props.onClick(); await settle();
  let headerNotifications = 0;
  const survivingHeader = () => { headerNotifications++; };
  addListener('studio-photo-changed', survivingHeader);
  cleanups.forEach(cleanup => cleanup?.()); assert.equal(activeUrls.size, 0);
  const writesBeforeResolution = stateWrites;
  gate(); gate = null; await settle();
  assert.equal(headerNotifications, 1, 'successful upload after Settings unmount still refreshes surviving header');
  assert.equal(stateWrites, writesBeforeResolution, 'no unmounted Settings state updates');
  removeListener('studio-photo-changed', survivingHeader); assert.equal(listeners.size, 0);
  console.log('Studio photo UI checks passed: empty/load, file-type guard, local-only preview, decode gate, unchanged File upload, duplicate guard, refresh notification, revoke URLs, cancel/remove, uncertain write, retry, expired-session privacy clearing, cleanup, pending save → Settings unmount → surviving header refresh.');
})().catch(error => { console.error(error); process.exitCode = 1; });
